#!/usr/bin/env bash
# 1대1채팅 릴리스 빌드
#
# 사용법:
#   KEYSTORE_FILE=/경로/release-key.jks KEYSTORE_PASS='비밀번호' ./scripts/build-release.sh 1.0.1 [--publish]
#
# 하는 일:
#   1. 버전 번호를 화면(web/1on1-chat.html), 데스크톱(package.json), 안드로이드(build.gradle)에 반영
#   2. dist/ 아래에 만든다
#        1대1채팅.html            브라우저용 (윈도우 앱의 '지금 업데이트'도 이 파일을 받는다)
#        1대1채팅-Windows.zip     윈도우 앱 전체 (100MB가 넘어 저장소에는 못 올린다. 처음 설치용으로 따로 전달)
#        1대1채팅.apk             안드로이드 앱 (KEYSTORE_FILE이 있을 때만)
#   3. release/ 폴더에 html·apk와 latest.json을 넣는다. 앱들은 이 latest.json을 보고 새 버전을 알린다.
#        latest.json = { version, date, notes(CHANGELOG의 해당 버전), minShell, html, apk, windowsZip }
#        윈도우 앱 껍데기(desktop/main.js·preload.js)를 바꿨으면 desktop/min-shell.txt를 그 버전으로 올린다.
#        그러면 윈도우 앱은 '지금 업데이트' 대신 새 압축 파일(WINDOWS_ZIP_URL, 없으면 Releases 페이지)을 받으라고 안내한다.
#   4. --publish면 release/를 커밋해 main에 올린다.
#
# 필요한 것: node 22+, python3, JDK 21, Android SDK(ANDROID_HOME, platform 36·build-tools 36), gh
#
# 안드로이드 서명 키(release-key.jks)는 저장소에 넣지 않는다. 키가 바뀌면 기존 설치본 위에 업데이트가 안 되니 잘 보관할 것.
set -euo pipefail

VER="${1:-}"; PUBLISH="${2:-}"
[[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "버전을 1.2.3 형식으로 주세요"; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; DIST="$ROOT/dist"; mkdir -p "$DIST"
IFS=. read -r MA MI PA <<< "$VER"; CODE=$((MA * 10000 + MI * 100 + PA))
MIN_SHELL="$(tr -d ' \n' < "$ROOT/desktop/min-shell.txt")"

echo "▶ 버전 $VER (안드로이드 versionCode $CODE, 데스크톱 최소 껍데기 $MIN_SHELL)"
sed -i -E "s/const APP_VERSION = '[0-9.]+'/const APP_VERSION = '$VER'/" "$ROOT/web/1on1-chat.html"
grep -q "const APP_VERSION = '$VER'" "$ROOT/web/1on1-chat.html"
node -e "const f='$ROOT/desktop/package.json',p=require(f);p.version='$VER';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"
sed -i -E "s/versionCode [0-9]+/versionCode $CODE/; s/versionName \"[^\"]+\"/versionName \"$VER\"/" "$ROOT/mobile/android/app/build.gradle"

cp "$ROOT/web/1on1-chat.html" "$DIST/1대1채팅.html"

echo "▶ 윈도우 앱"
cp "$ROOT/web/1on1-chat.html" "$ROOT/desktop/app/index.html"
( cd "$ROOT/desktop" && npm ci --no-audit --no-fund >/dev/null && rm -rf out && \
  npx @electron/packager . OneOnOneChat --platform=win32 --arch=x64 --out=out --icon=build/icon.ico --overwrite --asar \
    --ignore='^/build$' --ignore='^/out$' --ignore='^/node_modules' --ignore='package-lock\.json' --ignore='min-shell\.txt' --ignore='사용법\.txt' \
    --app-copyright='1대1채팅' --win32metadata.ProductName='1대1채팅' --win32metadata.FileDescription='1대1채팅' --win32metadata.CompanyName='1대1채팅' >/dev/null )
W="$ROOT/desktop/out/OneOnOneChat-win32-x64"
find "$W/locales" -name '*.pak' ! -name 'ko.pak' ! -name 'en-US.pak' -delete
cp "$ROOT/desktop/사용법.txt" "$W/사용법.txt"
python3 - "$W" "$DIST/1대1채팅-Windows.zip" <<'PY'
import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, _, files in os.walk(src):
        for f in files:
            p = os.path.join(root, f); z.write(p, os.path.join('1대1채팅', os.path.relpath(p, src)))
PY

if [[ -n "${KEYSTORE_FILE:-}" && -f "${KEYSTORE_FILE}" ]]; then
  echo "▶ 안드로이드 앱"
  : "${KEYSTORE_PASS:?KEYSTORE_PASS가 필요합니다}"
  : "${ANDROID_HOME:?ANDROID_HOME이 필요합니다}"
  cp "$ROOT/web/1on1-chat.html" "$ROOT/mobile/www/index.html"
  cp "$KEYSTORE_FILE" "$ROOT/mobile/android/release-key.jks"
  printf 'storeFile=release-key.jks\nstorePassword=%s\nkeyAlias=oneonone\nkeyPassword=%s\n' "$KEYSTORE_PASS" "$KEYSTORE_PASS" > "$ROOT/mobile/android/keystore.properties"
  echo "sdk.dir=$ANDROID_HOME" > "$ROOT/mobile/android/local.properties"
  ( cd "$ROOT/mobile" && npm ci --no-audit --no-fund >/dev/null && npx cap sync android >/dev/null && cd android && \
    for i in 1 2 3; do ./gradlew --no-daemon -q assembleRelease && break; echo "  (Maven 요청 제한일 수 있어 다시 시도)"; sleep 20; done )
  cp "$ROOT/mobile/android/app/build/outputs/apk/release/app-release.apk" "$DIST/1대1채팅.apk"
  rm -f "$ROOT/mobile/android/release-key.jks" "$ROOT/mobile/android/keystore.properties"
else
  echo "▶ 안드로이드 앱: KEYSTORE_FILE이 없어 건너뜀"
fi

ls -la "$DIST"

echo "▶ release/ 폴더"
REL="$ROOT/release"; mkdir -p "$REL"
cp "$DIST/1대1채팅.html" "$REL/1대1채팅.html"
APK_FIELD=null
if [[ -f "$DIST/1대1채팅.apk" ]]; then cp "$DIST/1대1채팅.apk" "$REL/1대1채팅.apk"; APK_FIELD='"1대1채팅.apk"'; elif [[ -f "$REL/1대1채팅.apk" ]]; then echo "  (경고) 이번 APK를 만들지 못해 이전 APK가 남아 있습니다"; fi
NOTES="$(awk -v v="## v$VER" '$0==v{f=1;next} /^## v/{f=0} f' "$ROOT/CHANGELOG.md")"
VER="$VER" MIN_SHELL="$MIN_SHELL" NOTES="$NOTES" APK_FIELD="$APK_FIELD" ZIP="${WINDOWS_ZIP_URL:-}" node -e '
const e = process.env, out = { version: e.VER, date: new Date().toISOString().slice(0, 10), notes: e.NOTES.trim() || ("v" + e.VER),
  minShell: e.MIN_SHELL, html: "1대1채팅.html", apk: JSON.parse(e.APK_FIELD), windowsZip: e.ZIP || null };
require("fs").writeFileSync(process.argv[1], JSON.stringify(out, null, 2) + "\n");' "$REL/latest.json"
cat "$REL/latest.json"

if [[ "$PUBLISH" == "--publish" ]]; then
  echo "▶ main에 올리기"
  cd "$ROOT"
  git add release web desktop/package.json mobile/android/app/build.gradle CHANGELOG.md
  git commit -m "v$VER 배포" && git push origin HEAD:main
fi
