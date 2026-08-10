# Azure Setup — Section 2: Dev Environment Resources

Run with Azure CLI, already `az login`'d. Replace `<yourname>` with something
short and unique (initials are fine) — Azure needs some names to be globally
unique.

## 1. Resource group (shared across dev/uat/prod)

One resource group for the whole project — simpler to see everything
together and track cost. Environments are kept apart by resource *naming*
(dev/uat/prod in each name), not separate resource groups.

```bash
az group create --name playcircle-rg --location centralindia
```

## 2. Postgres server (shared) + Dev database

One server now, hosting just `playcircle_dev` for the moment. `playcircle_uat`
and `playcircle_prod` get added later with one more `db create` command each
— the server itself won't need to change.

```bash
az postgres flexible-server create \
  --resource-group playcircle-rg \
  --name playcircle-db-<yourname> \
  --location centralindia \
  --admin-user playcircleadmin \
  --admin-password "<CHOOSE-A-STRONG-PASSWORD>" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32 \
  --version 16 \
  --public-access 0.0.0.0-255.255.255.255

az postgres flexible-server db create \
  --resource-group playcircle-rg \
  --server-name playcircle-db-<yourname> \
  --database-name playcircle_dev
```

(Same pragmatic wide-open `--public-access` as before — Postgres itself is
still password-protected. Tighten later.)

## 3. App Service (backend, Dev)

Its own plan and app — not shared with future uat/prod, so a heavy dev test
can't slow down another environment.

```bash
az appservice plan create \
  --resource-group playcircle-rg \
  --name playcircle-plan-dev \
  --is-linux \
  --sku B1

az webapp create \
  --resource-group playcircle-rg \
  --plan playcircle-plan-dev \
  --name playcircle-api-dev-<yourname> \
  --runtime "PYTHON:3.12" \
  --startup-file "startup.sh"
```

### Configure its environment variables

```bash
az webapp config appsettings set \
  --resource-group playcircle-rg \
  --name playcircle-api-dev-<yourname> \
  --settings \
    PLAYCIRCLE_DB_HOST="playcircle-db-<yourname>.postgres.database.azure.com" \
    PLAYCIRCLE_PORT="5432" \
    PLAYCIRCLE_USER="playcircleadmin" \
    PLAYCIRCLE_PASSWORD="<THE-SAME-PASSWORD-FROM-STEP-2>" \
    PLAYCIRCLE_NAME="playcircle_dev" \
    PLAYCIRCLE_DB_SSL_MODE="require" \
    PLAYCIRCLE_JWT_SECRET_KEY="<GENERATE-BELOW>" \
    PLAYCIRCLE_CORS_ORIGINS="*" \
    SCM_DO_BUILD_DURING_DEPLOYMENT="true"
```

Generate the JWT secret:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

`PLAYCIRCLE_CORS_ORIGINS="*"` is a placeholder — we'll tighten it to the
real frontend URL in Section 4, once that URL exists.

### Get the publish profile (needed for GitHub Actions in Section 3)

```bash
az webapp deployment list-publishing-profiles \
  --resource-group playcircle-rg \
  --name playcircle-api-dev-<yourname> \
  --xml
```

Save this output somewhere for a moment — you'll paste it into a GitHub
secret next.

## 4. Static Web App (frontend, Dev)

```bash
az staticwebapp create \
  --resource-group playcircle-rg \
  --name playcircle-web-dev-<yourname> \
  --location centralus \
  --sku Free
```

(Free tier is only available in specific regions — `centralus`, `eastus2`,
`westus2`, `westeurope`, `eastasia`. Pick whichever's closest if not US.)

### Get its deployment token

```bash
az staticwebapp secrets list \
  --resource-group playcircle-rg \
  --name playcircle-web-dev-<yourname> \
  --query "properties.apiKey" -o tsv
```

Save this too.

---

**That's everything for this section.** You should now have: one resource
group, one Postgres server with a `playcircle_dev` database, one App Service
running (but not yet deployed to — that's Section 3), and one Static Web App
(same). Once you've run these and have both saved values (publish profile
XML + deployment token) in hand, tell me and we'll move to wiring up the
GitHub Actions side.
