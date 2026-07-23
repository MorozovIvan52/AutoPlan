import paramiko
from pathlib import Path

key = Path.home() / ".ssh" / "crm_vps_ed25519"
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "159.194.207.50",
    username="root",
    pkey=paramiko.Ed25519Key.from_private_key_file(str(key)),
    timeout=20,
    allow_agent=False,
    look_for_keys=False,
)
cmd = r"""
set -e
cd /opt/crm
tar -xzf /tmp/restore_nav_bundle.tar.gz
python3 -c "from pathlib import Path; b=Path('src/lib/nav.ts').read_bytes(); print('delivery', b'/delivery' in b); print('zzap page', Path('src/pages/zzap.tsx').stat().st_size); print('settings', Path('src/pages/settings.tsx').stat().st_size)"
npm run build
pm2 restart crm --update-env
echo DONE_OK
"""
stdin, stdout, stderr = c.exec_command(cmd, timeout=180)
out = stdout.read().decode("utf-8", "replace")
err = stderr.read().decode("utf-8", "replace")
Path(r"C:\Users\1\Desktop\autoplan\_deploy_restore_log.txt").write_text(out + "\n---STDERR---\n" + err, encoding="utf-8")
print("exit", stdout.channel.recv_exit_status())
print("wrote log")
c.close()
