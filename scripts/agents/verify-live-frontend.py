import urllib.request
import re
import time

hosts = ["https://sto1.crmavito.online", "https://crmavito.online"]
ts = str(time.time())
for host in hosts:
    try:
        html = urllib.request.urlopen(host + "/?_=" + ts, timeout=15).read().decode("utf-8", "replace")
        meta = re.search(r'crm-build-id" content="([^"]+)"', html)
        script = re.search(r'src="(/assets/[^"]+)"', html)
        print(
            host,
            "meta",
            meta.group(1) if meta else None,
            "script",
            script.group(1) if script else None,
            "kill",
            "crm-banner-killswitch" in html,
        )
        j = urllib.request.urlopen(host + "/crm-build-id.json?_=" + ts, timeout=10).read().decode()
        print(" json", j)
        if script:
            js = urllib.request.urlopen(host + script.group(1), timeout=30).read().decode("utf-8", "replace")
            print(
                " hasZN",
                "Заказ-наряд" in js,
                "hasOpenTabs",
                "crm-open-tabs" in js or "Открытые разделы" in js,
                "idInJs",
                (meta.group(1) in js) if meta else False,
            )
    except Exception as e:
        print(host, "ERR", e)
