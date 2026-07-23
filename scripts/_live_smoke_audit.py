import paramiko
from pathlib import Path
import json

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

# Live smoke: login + GET pages/API for restored modules
script = r'''
python3 <<'PY'
import json, urllib.request, http.cookiejar
base='https://crmavito.online'
cj=http.cookiejar.CookieJar()
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def req(method, path, data=None, headers=None):
    h={'Content-Type':'application/json','x-tenant-slug':'sto-1'}
    if headers: h.update(headers)
    body=None
    if data is not None:
        body=json.dumps(data).encode()
    r=urllib.request.Request(base+path, data=body, headers=h, method=method)
    try:
        with opener.open(r, timeout=30) as resp:
            return resp.status, resp.read()[:200]
    except Exception as e:
        if hasattr(e,'code'):
            return e.code, str(e)
        return 0, str(e)

st, body = req('POST','/api/auth/login',{'email':'admin@sto1.demo','password':'PilotDemo2026!'})
print('login', st)

apis=[
 '/api/health',
 '/api/clients',
 '/api/cdek/shipments',
 '/api/buyouts',
 '/api/zzap/status',
 '/api/zzap/lists',
 '/api/payroll/roles',
 '/api/payroll/my',
 '/api/ai/status',
 '/api/crm/settings',
 '/api/sales',
]
for p in apis:
    st,_=req('GET',p)
    print('API', p, st)

# SPA routes exist in bundle
from pathlib import Path
js=next(Path('/opt/crm/dist/assets').glob('index-*.js'))
t=js.read_text(encoding='utf-8', errors='replace')
for s in ['/delivery','/zzap','/buyouts','/payroll','/my-salary','/assistant','/zn','/money','Расчёт ЗП','Моя зарплата','Доставка']:
    print('BUNDLE', s, s in t)

# settings no mobile nav
stext=Path('/opt/crm/src/pages/settings.tsx').read_text(encoding='utf-8', errors='replace')
print('SETTINGS_MOBILE_NAV', 'settings-layout__nav-mobile' in stext)
print('SETTINGS_TABS', all(x in stext for x in ['security','alerts','general','sales']))
PY
'''
stdin, stdout, stderr = c.exec_command(script, timeout=90)
out = stdout.read().decode('utf-8', 'replace')
err = stderr.read().decode('utf-8', 'replace')
Path(r'C:\Users\1\Desktop\autoplan\docs\agents\reports\_live_smoke.txt').write_text(out + '\n' + err, encoding='utf-8')
print(out)
c.close()
