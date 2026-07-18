# Backup Checklist For CRM AvtoPlan

## Daily checklist

1. Verify the nightly backup job finished successfully.
2. Verify a new archive appeared in S3 or off-site storage.
3. Verify backup log contains `backup done`.
4. Verify free disk space on the VPS is above 20%.
5. Verify backup age is less than 25 hours.

## Weekly checklist

1. Download one fresh backup archive to a separate machine.
2. Open the archive and confirm it contains `crm.db`, `uploads/`, and `data/`.
3. Run a test restore into a temporary folder.
4. Start the app against the restored data and confirm login works.
5. Open at least one client, one deal, and one conversation after restore.

## Monthly checklist

1. Restore the latest backup to a staging server.
2. Verify tenant separation after restore:
   - tenant A cannot see tenant B users
   - tenant A cannot see tenant B deals
   - tenant A cannot see tenant B conversations
3. Verify at least one old backup can still be restored.
4. Rotate S3 keys or confirm rotation date.
5. Review retention policy and storage costs.

## Production backup scope

- Database: `crm.db` via `sqlite3 .backup`
- User files: `uploads/`
- App data: `data/`
- Environment and infra config:
  - `/opt/crm/.env`
  - `/opt/crm/.env.s3`
  - nginx site config
  - PM2 ecosystem file if used

## Required storage rules

- Keep at least 7 daily backups.
- Keep at least 4 weekly backups.
- Keep at least 6 monthly backups.
- Keep at least 1 off-site copy.
- Do not store the only backup on the same VPS.

## Must-have alerts

- No successful backup for 25 hours.
- Backup script exit code is non-zero.
- S3 upload failed.
- VPS free disk below 15%.
- Restore test failed.

## Disaster recovery drill

1. Stop the app: `pm2 stop crm`
2. Restore database and files from the selected archive.
3. Start the app: `pm2 start crm`
4. Check `https://crmavito.online/api/health`
5. Log in as tenant admin and validate clients, deals, chats, and stock.
6. Record restore duration and any manual fixes needed.

## Pass criteria

Backup is considered healthy only if all three are true:

- the archive was created,
- the archive was uploaded off-site,
- a restore test succeeds.
