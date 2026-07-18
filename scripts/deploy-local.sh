#!/usr/bin/env bash
# deploy-local.sh — lets-craft 플러그인을 로컬 omp에 배포한다.
#
# 하는 일 (전부 멱등):
#   1. 의존성 설치(node_modules 없을 때만, --install로 강제)
#   2. 빌드: scripts/gen-version.mjs(버전·git·srcHash 각인) + tsc → dist/
#   3. (--test 시) 단위 테스트 스위트 실행 — 실패하면 배포 중단
#   4. 링크: ~/.omp/plugins/node_modules/lets-craft → 이 리포 (심볼릭 링크 생성/교정)
#      - 잘못된 링크는 교체, 실디렉터리가 있으면 .bak.<ts>로 백업 후 교체
#   5. 등록: ~/.omp/plugins/omp-plugins.lock.json에 lets-craft 엔트리 보장(enabled)
#   6. 검증: dist/main.js 실존 + 각인된 버전 출력
#
# 사용법:
#   scripts/deploy-local.sh            # 빌드 + 링크 + 등록
#   scripts/deploy-local.sh --test     # 테스트 통과 후에만 배포
#   scripts/deploy-local.sh --install  # npm install 강제 후 배포
#
# 주의: omp는 플러그인을 세션 시작 시 로드하므로, 배포 후 실행 중인 omp 세션은
#       재시작해야 새 버전이 붙는다. (전역 dist 로드 — 워크트리에서 빌드해도
#       이 링크가 가리키는 메인 리포의 dist만 로드됨)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OMP_PLUGINS_DIR="${OMP_PLUGINS_DIR:-${HOME}/.omp/plugins}"
LINK_PATH="${OMP_PLUGINS_DIR}/node_modules/lets-craft"
LOCK_FILE="${OMP_PLUGINS_DIR}/omp-plugins.lock.json"

RUN_TESTS=0
FORCE_INSTALL=0
for arg in "$@"; do
	case "$arg" in
		--test) RUN_TESTS=1 ;;
		--install) FORCE_INSTALL=1 ;;
		-h|--help)
			sed -n '2,20p' "${BASH_SOURCE[0]}"
			exit 0
			;;
		*)
			echo "[deploy-local] 알 수 없는 옵션: $arg (--test | --install | --help)" >&2
			exit 2
			;;
	esac
done

log() { printf '[deploy-local] %s\n' "$*"; }

cd "$REPO_ROOT"

# 1. 의존성
if [[ $FORCE_INSTALL -eq 1 || ! -d node_modules ]]; then
	log "npm install 실행..."
	npm install
fi

# 2. 빌드 (gen-version이 version/git/srcHash를 dist에 각인)
log "빌드 중 (gen-version + tsc)..."
npm run build

# 3. 테스트 (옵션)
if [[ $RUN_TESTS -eq 1 ]]; then
	log "단위 테스트 실행 중..."
	npm test
fi

# 4. 심볼릭 링크
mkdir -p "${OMP_PLUGINS_DIR}/node_modules"
if [[ -L "$LINK_PATH" ]]; then
	CURRENT_TARGET="$(readlink "$LINK_PATH")"
	if [[ "$CURRENT_TARGET" != "$REPO_ROOT" ]]; then
		log "기존 링크가 다른 곳(${CURRENT_TARGET})을 가리킴 — 교체"
		rm "$LINK_PATH"
		ln -s "$REPO_ROOT" "$LINK_PATH"
	else
		log "링크 확인: ${LINK_PATH} → ${REPO_ROOT} (변경 없음)"
	fi
elif [[ -e "$LINK_PATH" ]]; then
	BACKUP="${LINK_PATH}.bak.$(date +%Y%m%d%H%M%S)"
	log "실디렉터리/파일이 존재 — ${BACKUP}으로 백업 후 링크 생성"
	mv "$LINK_PATH" "$BACKUP"
	ln -s "$REPO_ROOT" "$LINK_PATH"
else
	log "링크 생성: ${LINK_PATH} → ${REPO_ROOT}"
	ln -s "$REPO_ROOT" "$LINK_PATH"
fi

# 5. lock 파일 등록 (node로 JSON 편집 — jq 의존 없음)
log "플러그인 등록 확인 (${LOCK_FILE})..."
LOCK_FILE="$LOCK_FILE" REPO_ROOT="$REPO_ROOT" node --input-type=module -e '
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const lockFile = process.env.LOCK_FILE;
const repoRoot = process.env.REPO_ROOT;
const pkg = JSON.parse(readFileSync(`${repoRoot}/package.json`, "utf8"));
let lock = { plugins: {}, settings: {} };
if (existsSync(lockFile)) {
	try { lock = JSON.parse(readFileSync(lockFile, "utf8")); } catch { /* 손상 시 재생성 */ }
}
lock.plugins ??= {};
const prev = lock.plugins["lets-craft"];
lock.plugins["lets-craft"] = {
	version: pkg.version,
	enabledFeatures: prev?.enabledFeatures ?? null,
	enabled: true,
};
lock.settings ??= {};
writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`[deploy-local] lock 갱신: lets-craft v${pkg.version} (enabled)`);
'

# 6. 검증
if [[ ! -f "${REPO_ROOT}/dist/main.js" ]]; then
	log "오류: dist/main.js가 없습니다 — 빌드 실패?" >&2
	exit 1
fi
STAMP="$(REPO_ROOT="$REPO_ROOT" node --input-type=module -e '
const { BUILD_INFO } = await import(`${process.env.REPO_ROOT}/dist/generated/version.js`);
console.log(`v${BUILD_INFO.version} git=${BUILD_INFO.gitHash} srcHash=${BUILD_INFO.srcHash}`);
')"

log "배포 완료: ${STAMP}"
log "실행 중인 omp 세션은 재시작해야 새 버전이 로드됩니다."
