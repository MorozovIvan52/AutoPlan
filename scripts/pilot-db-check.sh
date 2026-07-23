#!/usr/bin/env bash
cd /opt/crm
echo "=== tenants ==="
sqlite3 crm.db "SELECT id, slug, name FROM tenants WHERE slug LIKE 'sto-%';"
echo "=== deals count ==="
sqlite3 crm.db "SELECT tenant_id, COUNT(*) FROM deals GROUP BY tenant_id;"
echo "=== deals sto-1 ==="
sqlite3 crm.db "SELECT id, tenant_id, order_type, status FROM deals WHERE tenant_id=(SELECT id FROM tenants WHERE slug='sto-1');"
echo "=== users sto-1 ==="
sqlite3 crm.db "SELECT id, email, tenant_id FROM users WHERE tenant_id=(SELECT id FROM tenants WHERE slug='sto-1');"
