#!/bin/bash
set -e

# ============================================================
# STEP 1 — Databases (same Postgres server as Dev — zero extra cost)
# ============================================================
az postgres flexible-server db create \
  --resource-group playcircle-rg \
  --server-name playcircle-db-jaybee \
  --database-name playcircle_uat

az postgres flexible-server db create \
  --resource-group playcircle-rg \
  --server-name playcircle-db-jaybee \
  --database-name playcircle_prod

# ============================================================
# STEP 2 — UAT backend: Free tier App Service Plan + Web App
# ============================================================
az appservice plan create \
  --resource-group playcircle-webapp-rg \
  --name playcircle-plan-uat \
  --sku F1 \
  --is-linux

az webapp create \
  --resource-group playcircle-webapp-rg \
  --plan playcircle-plan-uat \
  --name playcircle-api-uat-jaybee \
  --runtime "PYTHON:3.12"

az webapp config set \
  --resource-group playcircle-webapp-rg \
  --name playcircle-api-uat-jaybee \
  --startup-file "bash startup.sh"

# ============================================================
# STEP 3 — Prod backend: Basic B1 tier (Free tier's CPU cap isn't
# appropriate once this is genuinely "production", even a small one)
# ============================================================
az appservice plan create \
  --resource-group playcircle-webapp-rg \
  --name playcircle-plan-prod \
  --sku B1 \
  --is-linux

az webapp create \
  --resource-group playcircle-webapp-rg \
  --plan playcircle-plan-prod \
  --name playcircle-api-prod-jaybee \
  --runtime "PYTHON:3.12"

az webapp config set \
  --resource-group playcircle-webapp-rg \
  --name playcircle-api-prod-jaybee \
  --startup-file "bash startup.sh"

# ============================================================
# STEP 4 — App settings for both (mirror Dev's, pointing at the
# new databases).
# ============================================================
read -sp "Enter the Postgres admin password: " DB_PASSWORD
echo

for ENV in uat prod; do
  az webapp config appsettings set \
    --resource-group playcircle-webapp-rg \
    --name playcircle-api-${ENV}-jaybee \
    --settings \
      PLAYCIRCLE_DB_HOST="playcircle-db-jaybee.postgres.database.azure.com" \
      PLAYCIRCLE_PORT="5432" \
      PLAYCIRCLE_USER="playcircleadmin" \
      PLAYCIRCLE_PASSWORD="$DB_PASSWORD" \
      PLAYCIRCLE_NAME="playcircle_${ENV}" \
      PLAYCIRCLE_DB_SSL_MODE="require" \
      PLAYCIRCLE_JWT_SECRET_KEY="$(openssl rand -hex 32)" \
      SCM_DO_BUILD_DURING_DEPLOYMENT="true"
done

# ============================================================
# STEP 5 — Frontend: Static Web Apps, Free tier for both (no CPU
# cap like App Service F1 has — Free tier is fine even for Prod
# on a small static frontend)
# ============================================================
az staticwebapp create \
  --resource-group playcircle-webapp-rg \
  --name playcircle-web-uat-jaybee \
  --location "East Asia" \
  --sku Free

az staticwebapp create \
  --resource-group playcircle-webapp-rg \
  --name playcircle-web-prod-jaybee \
  --location "East Asia" \
  --sku Free

echo "Done. Now grab these for GitHub secrets:"
echo "--- UAT backend publish profile ---"
az webapp deployment list-publishing-profiles \
  --resource-group playcircle-webapp-rg \
  --name playcircle-api-uat-jaybee --xml
echo "--- Prod backend publish profile ---"
az webapp deployment list-publishing-profiles \
  --resource-group playcircle-webapp-rg \
  --name playcircle-api-prod-jaybee --xml
echo "--- UAT static web app token ---"
az staticwebapp secrets list \
  --resource-group playcircle-webapp-rg \
  --name playcircle-web-uat-jaybee --query "properties.apiKey" -o tsv
echo "--- Prod static web app token ---"
az staticwebapp secrets list \
  --resource-group playcircle-webapp-rg \
  --name playcircle-web-prod-jaybee --query "properties.apiKey" -o tsv
