"""웹앱 빌드(web/dist) + data 브랜치의 화면용 데이터(data/) 전체를 site/ 로 묶는다.
deploy-pages는 사이트 전체를 교체하므로, 어느 배치가 배포하든 전체 데이터를 함께 넣는다(3-4). state/ 는 넣지 않는다."""
import shutil
import sys
from pathlib import Path

site, dist, data = Path("site"), Path("web/dist"), Path("_data/data")
if site.exists():
    shutil.rmtree(site)
if not dist.exists():
    sys.exit("web/dist 없음 — npm run build 먼저")
shutil.copytree(dist, site)
if data.exists():
    shutil.copytree(data, site / "data")
(site / ".nojekyll").write_text("")
n = sum(1 for _ in site.rglob("*") if _.is_file())
print(f"[assemble] site 파일 {n}개")
