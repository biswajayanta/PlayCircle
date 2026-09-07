import io
import re
import uuid
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from openpyxl import Workbook
from openpyxl.styles import Font
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.db import get_pool
from app.deps import get_current_user_id
from app.schemas.ledger import (
    CircleLedger,
    LedgerBalance,
    LedgerEntry,
    PersonalCircleLedger,
    PersonalContribution,
    SettlementSuggestion,
    TransferCreate,
    TransferOut,
    UserLedgerOut,
)

router = APIRouter()


async def _require_circle_member(conn, circle_id: uuid.UUID, user_id: uuid.UUID):
    circle_row = await conn.fetchrow("SELECT id FROM social.circles WHERE id = $1", circle_id)
    if circle_row is None:
        raise HTTPException(status_code=404, detail="Circle not found")
    is_member = await conn.fetchval(
        "SELECT 1 FROM social.circle_members WHERE circle_id = $1 AND user_id = $2",
        circle_id,
        user_id,
    )
    if not is_member:
        raise HTTPException(status_code=403, detail="You must be a member of this circle")


def _simplify_debts(net_balances: dict[uuid.UUID, Decimal]) -> list[tuple[uuid.UUID, uuid.UUID, Decimal]]:
    """Standard greedy min-cash-flow settlement: repeatedly match the biggest
    creditor with the biggest debtor until everyone's balance is zero. Not
    guaranteed globally minimal in every edge case, but it's the well-known
    practical algorithm (same one Splitwise-style apps use) and always
    produces at most n-1 transactions for n people."""
    creditors = [[uid, bal] for uid, bal in net_balances.items() if bal > 0]
    debtors = [[uid, -bal] for uid, bal in net_balances.items() if bal < 0]
    creditors.sort(key=lambda x: x[1], reverse=True)
    debtors.sort(key=lambda x: x[1], reverse=True)

    transactions = []
    i, j = 0, 0
    while i < len(debtors) and j < len(creditors):
        debtor_id, debt_amt = debtors[i]
        creditor_id, credit_amt = creditors[j]
        amount = min(debt_amt, credit_amt)
        if amount > 0:
            transactions.append((debtor_id, creditor_id, amount))
        debtors[i][1] -= amount
        creditors[j][1] -= amount
        if debtors[i][1] <= Decimal("0.00"):
            i += 1
        if creditors[j][1] <= Decimal("0.00"):
            j += 1
    return transactions


@router.post("/circles/{circle_id}/transfers", response_model=TransferOut, status_code=201)
async def create_transfer(
    circle_id: uuid.UUID,
    payload: TransferCreate,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    if payload.from_user_id == payload.to_user_id:
        raise HTTPException(status_code=422, detail="from_user_id and to_user_id must differ")

    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _require_circle_member(conn, circle_id, current_user_id)

            member_rows = await conn.fetch(
                "SELECT user_id FROM social.circle_members WHERE circle_id = $1 AND user_id = ANY($2::uuid[])",
                circle_id,
                [payload.from_user_id, payload.to_user_id],
            )
            member_ids = {r["user_id"] for r in member_rows}
            if payload.from_user_id not in member_ids or payload.to_user_id not in member_ids:
                raise HTTPException(
                    status_code=422, detail="Both from_user_id and to_user_id must be members of this circle"
                )

            row = await conn.fetchrow(
                """
                WITH inserted AS (
                    INSERT INTO financial.circle_transfers
                        (circle_id, from_user_id, to_user_id, amount, note, recorded_by_user_id)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING id, circle_id, from_user_id, to_user_id, amount, note,
                        recorded_by_user_id, created_at
                )
                SELECT
                    inserted.id, inserted.circle_id,
                    inserted.from_user_id, uf.display_name AS from_display_name,
                    inserted.to_user_id, ut.display_name AS to_display_name,
                    inserted.amount, inserted.note, inserted.recorded_by_user_id, inserted.created_at
                FROM inserted
                JOIN core.users uf ON uf.id = inserted.from_user_id
                JOIN core.users ut ON ut.id = inserted.to_user_id
                """,
                circle_id,
                payload.from_user_id,
                payload.to_user_id,
                payload.amount,
                payload.note,
                current_user_id,
            )
    return TransferOut(**dict(row))


async def _gather_circle_ledger(
    conn, circle_id: uuid.UUID
) -> tuple[list[LedgerBalance], list[SettlementSuggestion], list[LedgerEntry]]:
    """The balances/suggestions/history for one circle — shared by the JSON
    ledger endpoint, the export endpoint, and the per-user personal ledger
    (which needs a circle's full balances to compute suggestions, even
    though it only surfaces the ones involving one particular user)."""
    member_rows = await conn.fetch(
        """
        SELECT u.id AS user_id, u.display_name
        FROM social.circle_members cm
        JOIN core.users u ON u.id = cm.user_id
        WHERE cm.circle_id = $1
        ORDER BY u.display_name
        """,
        circle_id,
    )

    paid_rows = await conn.fetch(
        """
        SELECT e.paid_by_user_id AS user_id, sum(e.amount) AS total
        FROM financial.expenses e
        JOIN social.games g ON g.id = e.game_id
        WHERE g.circle_id = $1
        GROUP BY e.paid_by_user_id
        """,
        circle_id,
    )
    owed_rows = await conn.fetch(
        """
        SELECT es.user_id, sum(es.share_amount) AS total
        FROM financial.expense_splits es
        JOIN financial.expenses e ON e.id = es.expense_id
        JOIN social.games g ON g.id = e.game_id
        WHERE g.circle_id = $1
        GROUP BY es.user_id
        """,
        circle_id,
    )
    transferred_out_rows = await conn.fetch(
        """
        SELECT from_user_id AS user_id, sum(amount) AS total
        FROM financial.circle_transfers
        WHERE circle_id = $1
        GROUP BY from_user_id
        """,
        circle_id,
    )
    transferred_in_rows = await conn.fetch(
        """
        SELECT to_user_id AS user_id, sum(amount) AS total
        FROM financial.circle_transfers
        WHERE circle_id = $1
        GROUP BY to_user_id
        """,
        circle_id,
    )

    paid = {r["user_id"]: r["total"] for r in paid_rows}
    owed = {r["user_id"]: r["total"] for r in owed_rows}
    transferred_out = {r["user_id"]: r["total"] for r in transferred_out_rows}
    transferred_in = {r["user_id"]: r["total"] for r in transferred_in_rows}

    net_balances: dict[uuid.UUID, Decimal] = {}
    balances = []
    for m in member_rows:
        uid = m["user_id"]
        balance = (
            paid.get(uid, Decimal("0"))
            - owed.get(uid, Decimal("0"))
            + transferred_out.get(uid, Decimal("0"))
            - transferred_in.get(uid, Decimal("0"))
        )
        net_balances[uid] = balance
        balances.append(LedgerBalance(user_id=uid, display_name=m["display_name"], balance=balance))

    raw_transactions = _simplify_debts(net_balances)
    display_names = {m["user_id"]: m["display_name"] for m in member_rows}
    suggested_settlements = [
        SettlementSuggestion(
            from_user_id=debtor_id,
            from_display_name=display_names[debtor_id],
            to_user_id=creditor_id,
            to_display_name=display_names[creditor_id],
            amount=amount.quantize(Decimal("0.01")),
        )
        for debtor_id, creditor_id, amount in raw_transactions
    ]

    expense_rows = await conn.fetch(
        """
        SELECT e.id, e.game_id, e.description, e.amount, e.created_at, u.display_name AS paid_by_display_name
        FROM financial.expenses e
        JOIN social.games g ON g.id = e.game_id
        JOIN core.users u ON u.id = e.paid_by_user_id
        WHERE g.circle_id = $1
        """,
        circle_id,
    )
    transfer_rows = await conn.fetch(
        """
        SELECT ct.id, ct.amount, ct.note, ct.created_at,
            uf.display_name AS from_display_name, ut.display_name AS to_display_name
        FROM financial.circle_transfers ct
        JOIN core.users uf ON uf.id = ct.from_user_id
        JOIN core.users ut ON ut.id = ct.to_user_id
        WHERE ct.circle_id = $1
        """,
        circle_id,
    )

    entries = [
        LedgerEntry(
            kind="expense",
            id=r["id"],
            description=r["description"],
            amount=r["amount"],
            created_at=r["created_at"],
            game_id=r["game_id"],
            paid_by_display_name=r["paid_by_display_name"],
        )
        for r in expense_rows
    ] + [
        LedgerEntry(
            kind="transfer",
            id=r["id"],
            # The payer/recipient are already their own columns in the
            # ledger UI, so the fallback here is deliberately generic
            # rather than repeating "X to Y".
            description=r["note"] or "Payment",
            amount=r["amount"],
            created_at=r["created_at"],
            from_display_name=r["from_display_name"],
            to_display_name=r["to_display_name"],
        )
        for r in transfer_rows
    ]
    entries.sort(key=lambda e: e.created_at, reverse=True)

    return balances, suggested_settlements, entries


@router.get("/circles/{circle_id}/ledger", response_model=CircleLedger)
async def get_circle_ledger(
    circle_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        await _require_circle_member(conn, circle_id, current_user_id)
        balances, suggested_settlements, entries = await _gather_circle_ledger(conn, circle_id)

    return CircleLedger(
        circle_id=circle_id,
        balances=balances,
        suggested_settlements=suggested_settlements,
        fully_settled=len(suggested_settlements) == 0,
        entries=entries,
    )


def _entry_payer(e: LedgerEntry) -> str:
    return e.paid_by_display_name if e.kind == "expense" else (e.from_display_name or "")


def _entry_recipient(e: LedgerEntry) -> str:
    return "Group" if e.kind == "expense" else (e.to_display_name or "")


def _build_ledger_xlsx(
    circle_name: str,
    balances: list[LedgerBalance],
    entries: list[LedgerEntry],
) -> bytes:
    wb = Workbook()
    ws_balances = wb.active
    ws_balances.title = "Balances"
    ws_balances.append(["Name", "Balance (INR)"])
    for cell in ws_balances[1]:
        cell.font = Font(bold=True)
    for b in balances:
        ws_balances.append([b.display_name, float(b.balance)])

    ws_history = wb.create_sheet("History")
    ws_history.append(["Date", "Payer", "Recipient", "Purpose", "Amount (INR)"])
    for cell in ws_history[1]:
        cell.font = Font(bold=True)
    for e in entries:
        ws_history.append(
            [
                e.created_at.strftime("%Y-%m-%d"),
                _entry_payer(e),
                _entry_recipient(e),
                e.description,
                float(e.amount),
            ]
        )

    for ws in (ws_balances, ws_history):
        for col_cells in ws.columns:
            length = max((len(str(c.value)) for c in col_cells if c.value is not None), default=0)
            ws.column_dimensions[col_cells[0].column_letter].width = min(max(length + 2, 10), 40)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _build_ledger_pdf(
    circle_name: str,
    balances: list[LedgerBalance],
    suggested_settlements: list[SettlementSuggestion],
    entries: list[LedgerEntry],
) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=18 * mm, bottomMargin=18 * mm)
    styles = getSampleStyleSheet()
    table_style = TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F6F50")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E7ECE9")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFBFA")]),
        ]
    )

    story = [Paragraph(f"{circle_name} — Ledger", styles["Title"]), Spacer(1, 12)]

    story.append(Paragraph("Balances", styles["Heading2"]))
    balance_data = [["Name", "Balance"]] + [
        [
            b.display_name,
            "Settled up"
            if b.balance == 0
            else f"Is owed Rs. {b.balance:.2f}"
            if b.balance > 0
            else f"Owes Rs. {-b.balance:.2f}",
        ]
        for b in balances
    ]
    balance_table = Table(balance_data, hAlign="LEFT")
    balance_table.setStyle(table_style)
    story += [balance_table, Spacer(1, 16)]

    story.append(Paragraph("Suggested settlements", styles["Heading2"]))
    if not suggested_settlements:
        story.append(Paragraph("Everyone's settled up.", styles["Normal"]))
    else:
        for s in suggested_settlements:
            story.append(
                Paragraph(
                    f"{s.from_display_name} owes {s.to_display_name} Rs. {s.amount:.2f}",
                    styles["Normal"],
                )
            )
    story.append(Spacer(1, 16))

    story.append(Paragraph("History", styles["Heading2"]))
    history_data = [["Date", "Payer", "Recipient", "Purpose", "Amount"]] + [
        [
            e.created_at.strftime("%d %b %Y"),
            _entry_payer(e),
            _entry_recipient(e),
            e.description,
            f"Rs. {e.amount:.2f}",
        ]
        for e in entries
    ]
    history_table = Table(history_data, hAlign="LEFT", repeatRows=1)
    history_table.setStyle(table_style)
    story.append(history_table)

    doc.build(story)
    return buf.getvalue()


@router.get("/circles/{circle_id}/ledger/export")
async def export_circle_ledger(
    circle_id: uuid.UUID,
    format: Literal["xlsx", "pdf"] = Query(...),
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    pool = get_pool()
    async with pool.acquire() as conn:
        await _require_circle_member(conn, circle_id, current_user_id)
        circle_name = await conn.fetchval("SELECT name FROM social.circles WHERE id = $1", circle_id)
        balances, suggested_settlements, entries = await _gather_circle_ledger(conn, circle_id)

    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "-", circle_name).strip("-") or "circle"

    if format == "xlsx":
        content = _build_ledger_xlsx(circle_name, balances, entries)
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = f"{safe_name}-ledger.xlsx"
    else:
        content = _build_ledger_pdf(circle_name, balances, suggested_settlements, entries)
        media_type = "application/pdf"
        filename = f"{safe_name}-ledger.pdf"

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/users/{user_id}/ledger", response_model=UserLedgerOut)
async def get_user_ledger(
    user_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
):
    """A user's own financial position, broken down per circle they belong
    to. Visibility is enforced per circle rather than with a blanket 403:
    a circle only appears if the caller IS that user, or owns that
    particular circle — any other caller just gets fewer/no circles back,
    not an error, since which circles they share isn't itself secret."""
    pool = get_pool()
    async with pool.acquire() as conn:
        circle_rows = await conn.fetch(
            """
            SELECT c.id AS circle_id, c.name AS circle_name, c.owner_user_id
            FROM social.circles c
            JOIN social.circle_members cm ON cm.circle_id = c.id
            WHERE cm.user_id = $1
            ORDER BY c.name
            """,
            user_id,
        )
        visible = [
            r
            for r in circle_rows
            if current_user_id == user_id or current_user_id == r["owner_user_id"]
        ]

        circles_out = []
        for c in visible:
            circle_id = c["circle_id"]
            balances, suggestions, _entries = await _gather_circle_ledger(conn, circle_id)
            my_balance = next(
                (b.balance for b in balances if b.user_id == user_id), Decimal("0")
            )
            quick_settle = [
                s for s in suggestions if user_id in (s.from_user_id, s.to_user_id)
            ]

            expense_rows = await conn.fetch(
                """
                SELECT e.id, e.description, es.share_amount, e.created_at, e.game_id,
                    e.paid_by_user_id, u.display_name AS paid_by_display_name,
                    sp.name AS sport_name, v.name AS venue_name, g.scheduled_at AS game_scheduled_at
                FROM financial.expense_splits es
                JOIN financial.expenses e ON e.id = es.expense_id
                JOIN social.games g ON g.id = e.game_id
                JOIN core.sports sp ON sp.id = g.sport_id
                JOIN core.venues v ON v.id = g.venue_id
                JOIN core.users u ON u.id = e.paid_by_user_id
                WHERE es.user_id = $1 AND g.circle_id = $2
                """,
                user_id,
                circle_id,
            )
            sent_rows = await conn.fetch(
                """
                SELECT ct.id, ct.amount, ct.note, ct.created_at, ut.display_name AS to_display_name
                FROM financial.circle_transfers ct
                JOIN core.users ut ON ut.id = ct.to_user_id
                WHERE ct.from_user_id = $1 AND ct.circle_id = $2
                """,
                user_id,
                circle_id,
            )
            received_rows = await conn.fetch(
                """
                SELECT ct.id, ct.amount, ct.note, ct.created_at, uf.display_name AS from_display_name
                FROM financial.circle_transfers ct
                JOIN core.users uf ON uf.id = ct.from_user_id
                WHERE ct.to_user_id = $1 AND ct.circle_id = $2
                """,
                user_id,
                circle_id,
            )

            entries = (
                [
                    PersonalContribution(
                        kind="expense_share",
                        id=r["id"],
                        description=r["description"],
                        amount=r["share_amount"],
                        created_at=r["created_at"],
                        counterparty_display_name=r["paid_by_display_name"],
                        is_payer=(r["paid_by_user_id"] == user_id),
                        game_id=r["game_id"],
                        sport_name=r["sport_name"],
                        venue_name=r["venue_name"],
                        game_scheduled_at=r["game_scheduled_at"],
                    )
                    for r in expense_rows
                ]
                + [
                    PersonalContribution(
                        kind="transfer_sent",
                        id=r["id"],
                        description=r["note"] or "Payment",
                        amount=r["amount"],
                        created_at=r["created_at"],
                        counterparty_display_name=r["to_display_name"],
                    )
                    for r in sent_rows
                ]
                + [
                    PersonalContribution(
                        kind="transfer_received",
                        id=r["id"],
                        description=r["note"] or "Payment",
                        amount=r["amount"],
                        created_at=r["created_at"],
                        counterparty_display_name=r["from_display_name"],
                    )
                    for r in received_rows
                ]
            )
            entries.sort(key=lambda e: e.created_at, reverse=True)

            circles_out.append(
                PersonalCircleLedger(
                    circle_id=circle_id,
                    circle_name=c["circle_name"],
                    balance=my_balance,
                    quick_settle=quick_settle,
                    entries=entries,
                )
            )

    return UserLedgerOut(user_id=user_id, circles=circles_out)
