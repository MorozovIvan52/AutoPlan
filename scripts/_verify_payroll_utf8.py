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
python3 <<'PY'
from pathlib import Path
b = Path('/opt/crm/src/lib/nav.ts').read_bytes()
print('payroll_label', 'Расчёт ЗП'.encode() in b)
print('my_salary', 'Моя зарплата'.encode() in b)
js = next(Path('/opt/crm/dist/assets').glob('index-*.js'))
t = js.read_bytes()
print('bundle_path_payroll', b'/payroll' in t)
print('bundle_payroll_text', 'Расчёт ЗП'.encode() in t)
print('bundle_my_text', 'Моя зарплата'.encode() in t)
print('no_mobile_nav', b'nav-mobile' not in Path('/opt/crm/src/pages/settings.tsx').read_bytes())
PY
"""
stdin, stdout, stderr = c.exec_command(cmd, timeout=30)
print(stdout.read().decode("utf-8", "replace"))
print(stderr.read().decode("utf-8", "replace"))
c.close()
