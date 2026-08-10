#!/bin/bash
set -e

# ============================================================
# STEP 1 — Create one Key Vault per environment (idempotent —
# safe to re-run; skips any that already exist).
# ============================================================
for ENV in dev uat prod; do
  if az keyvault show --name "playcircle-kv-${ENV}" &>/dev/null; then
    echo "playcircle-kv-${ENV} already exists, skipping creation."
  else
    az keyvault create \
      --resource-group playcircle-webapp-rg \
      --name "playcircle-kv-${ENV}" \
      --location "South India" \
      --enable-rbac-authorization true
  fi
done

# ============================================================
# STEP 1b — Under RBAC mode, NOBODY has access by default, not
# even the person who just created the vault. Grant yourself
# (the account running this script) permission to write secrets
# into each vault, then pause briefly — role assignments can take
# a minute or two to actually propagate before they work.
# ============================================================
MY_PRINCIPAL_ID=$(az ad signed-in-user show --query id -o tsv)

for ENV in dev uat prod; do
  VAULT_ID=$(az keyvault show --name "playcircle-kv-${ENV}" --query id -o tsv)
  az role assignment create \
    --role "Key Vault Secrets Officer" \
    --assignee "$MY_PRINCIPAL_ID" \
    --scope "$VAULT_ID" \
    --only-show-errors 2>/dev/null || echo "  (already granted on playcircle-kv-${ENV}, continuing)"
done

echo "Waiting 60 seconds for the role assignments above to propagate..."
sleep 60

# ============================================================
# STEP 2 — Populate each vault. DB_PASSWORD is the same value in
# all three right now (shared Postgres server, shared admin
# login) — that's fine, what matters is access scoping, not the
# value differing. JWT_SECRET is freshly generated per
# environment, closing the "shared JWT key" gap from the GRC
# review.
# ============================================================
read -sp "Enter the Postgres admin password: " DB_PASSWORD
echo

for ENV in dev uat prod; do
  az keyvault secret set \
    --vault-name "playcircle-kv-${ENV}" \
    --name "db-password" \
    --value "$DB_PASSWORD" > /dev/null

  az keyvault secret set \
    --vault-name "playcircle-kv-${ENV}" \
    --name "jwt-secret-key" \
    --value "$(openssl rand -hex 32)" > /dev/null

  echo "playcircle-kv-${ENV}: secrets set."
done

# ============================================================
# STEPS 3 & 4 — For each environment whose App Service already
# exists: give it a Managed Identity, grant it read access to its
# own vault only, then point its settings at Key Vault references.
# Environments whose App Service doesn't exist yet are skipped —
# just re-run this whole script once you've provisioned UAT/Prod,
# and it'll pick them up then (the vault + secrets from steps 1-2
# are already ready and waiting for them).
# ============================================================
for ENV in dev uat prod; do
  APP_NAME="playcircle-api-${ENV}-jaybee"

  if ! az webapp show --resource-group playcircle-webapp-rg --name "$APP_NAME" &>/dev/null; then
    echo "$APP_NAME doesn't exist yet — skipping (rerun this script after it's provisioned)."
    continue
  fi

  az webapp identity assign \
    --resource-group playcircle-webapp-rg \
    --name "$APP_NAME" > /dev/null

  echo "Waiting 30 seconds for the new managed identity to propagate in Azure AD..."
  sleep 30

  PRINCIPAL_ID=$(az webapp identity show \
    --resource-group playcircle-webapp-rg \
    --name "$APP_NAME" \
    --query principalId -o tsv)

  VAULT_ID=$(az keyvault show \
    --name "playcircle-kv-${ENV}" \
    --query id -o tsv)

  az role assignment create \
    --role "Key Vault Secrets User" \
    --assignee "$PRINCIPAL_ID" \
    --scope "$VAULT_ID" \
    --only-show-errors 2>/dev/null || echo "  ($APP_NAME already granted access, continuing)"

  DB_PW_URI=$(az keyvault secret show --vault-name "playcircle-kv-${ENV}" --name "db-password" --query id -o tsv)
  JWT_URI=$(az keyvault secret show --vault-name "playcircle-kv-${ENV}" --name "jwt-secret-key" --query id -o tsv)

  az webapp config appsettings set \
    --resource-group playcircle-webapp-rg \
    --name "$APP_NAME" \
    --settings \
      PLAYCIRCLE_PASSWORD="@Microsoft.KeyVault(SecretUri=${DB_PW_URI})" \
      PLAYCIRCLE_JWT_SECRET_KEY="@Microsoft.KeyVault(SecretUri=${JWT_URI})" > /dev/null

  echo "$APP_NAME: Managed Identity granted, settings now reference Key Vault."
done

echo ""
echo "Done. For each app that was actually updated, confirm the reference"
echo "resolved: Azure Portal -> that App Service -> Configuration -> the"
echo "two settings above should show a green checkmark, not a warning."
