# 1대1채팅

Gemini API로 캐릭터와 실시간으로 대화하는 앱입니다. 각자 자기 Gemini API 키를 넣어 씁니다.

## 내려받기

[Releases](https://github.com/harp1455/Chat/releases/latest)에서 쓰는 기기에 맞는 파일을 받으세요.

| 파일 | 용도 |
| --- | --- |
| `1대1채팅-Windows.zip` | 윈도우 앱. 압축을 풀고 `OneOnOneChat.exe` 실행. 자세한 내용은 안에 든 `사용법.txt` |
| `1대1채팅.apk` | 안드로이드 앱. 받은 파일을 열어 설치 (처음이면 ‘출처를 알 수 없는 앱 설치’ 허용) |
| `1대1채팅.html` | 설치 없이 브라우저(크롬·엣지)로 여는 버전. 선톡은 창이 열려 있을 때만 |

앱은 시작할 때와 6시간마다 이 저장소의 최신 릴리스를 확인해 새 버전을 알려 줍니다.

- 윈도우 앱: ‘지금 업데이트’를 누르면 바로 적용됩니다. 앱 껍데기가 바뀐 버전만 새 압축 파일을 받아 덮어쓰면 됩니다.
- 안드로이드 앱: 새 APK를 받아 설치하면 기존 앱 위에 덮어써지고 대화는 그대로 남습니다.
- HTML 파일: 새 파일을 받아 쓰던 파일에 덮어쓰세요.

대화와 설정은 각 기기 안에만 저장됩니다. 기기를 옮길 때는 설정 → ‘전체 백업 저장’ / ‘백업 불러오기’를 쓰세요. 백업에 API 키는 들어가지 않습니다.

## 폴더 구성

| 폴더 | 내용 |
| --- | --- |
| `web/1on1-chat.html` | 앱 화면 전체 (모든 기기가 같은 파일을 씀) |
| `desktop/` | 윈도우 앱 껍데기 (Electron): 트레이, 알림, 위젯 창, 화면 업데이트 |
| `mobile/` | 안드로이드 앱 껍데기 (Capacitor): `www/runners/proactive.js`가 앱을 닫아 둔 동안의 선톡 담당 |
| `scripts/build-release.sh` | 버전 반영, 세 가지 파일 빌드, 릴리스 올리기 |

## 새 버전 내기

1. `web/1on1-chat.html` 등 수정
2. `CHANGELOG.md` 맨 위에 `## v1.0.1` 형식으로 변경 내용 추가
3. `desktop/main.js`나 `desktop/preload.js`를 바꿨다면 `desktop/min-shell.txt`를 새 버전으로 올림
4. `KEYSTORE_FILE=… KEYSTORE_PASS=… ./scripts/build-release.sh 1.0.1 --publish`

안드로이드 서명 키는 저장소에 넣지 않습니다. 키가 바뀌면 기존 설치본 위에 업데이트할 수 없으니 따로 잘 보관하세요.
