# lets-craft

`lets-craft`는 [omp](https://www.npmjs.com/package/@oh-my-pi/pi-coding-agent)(`@oh-my-pi/pi-coding-agent`) 코딩 에이전트 CLI 위에서 동작하는 구조화 개발 파이프라인 플러그인입니다. "아이디어를 던지면 알아서 구현되는" 방식 대신, **조사 → 합의된 사양/계획/테스트 확보 → 테스트가 통과할 때까지 강제되는 구현 루프 → 적대적 감사 후 병합**이라는 명시적 단계를 거치도록 설계되었습니다.

이 플러그인은 `pre-craft` / `craft` / `post-craft`라는 3단계 철학으로 구성됩니다.

1. **pre-craft** — 아무 코드도 작성하지 않고, `trace(조사) → interview(요구사항 인터뷰) → plan(계획 합의) → test(테스트 작성)` 순서로 진행해 `.lsc/crafts/{feature}/` 아래에 `trace.md`, `spec.md`, `plan.md`, `test/`를 만듭니다. 이 산출물이 다음 단계의 유일한 입력입니다.
2. **craft** — pre-craft 산출물(또는 post-craft가 남긴 감사 결과)을 입력받아, `실행 서브에이전트 실행 → 테스트 자산 해시 검증 → run_test.sh 실행 → 반복` 루프를 `run_test.sh`가 통과할 때까지(또는 사용자가 명시적으로 중단할 때까지) 강제로 반복합니다. 이 단계에서는 테스트 코드 자체를 절대 수정하지 않습니다.
3. **post-craft** — craft가 만든 구현물을 `trace.md`/`spec.md`/`plan.md`에 대해 적대적으로 재검증하고, 4단계 판정(`APPROVE` / `APPROVE-WITH-COMMENT` / `APPROVE-WITH-CHANGE` / `REJECT`)을 `.lsc/crafts/{feature}/audit/audit-N.md`에 기록합니다. 판정에 따라 craft를 다시 호출하거나(수정 필요), 사용자의 명시적 승인 후 병합·워크트리 정리(land)까지 진행합니다.

모든 산출물은 기본적으로 프로젝트 디렉터리 안의 `.lsc/`에 저장되고, 전역 설정(모델 프리셋 등)은 `~/.omp/.lsc/`에 저장됩니다.

## 설치

### 요구사항

- **omp CLI(`@oh-my-pi/pi-coding-agent`)**: `package.json`의 devDependency로 `16.4.0`이 고정되어 있습니다. 소스 주석(`src/preset/spike.ts`)에도 이 버전에 대해 실제 동작이 검증되었다는 기록이 있습니다. `package.json`은 별도의 `engines` 필드를 선언하지 않으므로, 리포지토리 자체에 명시된 최소 버전 하한은 없습니다 — 실제로 검증·고정된 버전은 `16.4.0`입니다.
- **Node.js**: `package.json`에 `engines` 필드가 없어 리포지토리에 명시된 최소 버전은 없습니다. `tsconfig.json`이 `target: ES2022`, `module`/`moduleResolution: NodeNext`로 컴파일하므로, ESM과 NodeNext 모듈 해석을 지원하는 비교적 최신 Node 런타임이 필요합니다.
- 그 외 devDependencies: `typescript ^5.7.3`, `vitest ^3.0.5`. dependencies: `yaml ^2.9.0` (models.yaml 파싱용).

### 설치 절차

```bash
npm install
npm run build      # tsc — src/**/*.ts를 dist/ 로 컴파일 (package.json "build" 스크립트)
omp plugin link .   # 이 리포지토리를 omp 플러그인으로 심볼릭 링크 연결
```

`package.json`은 다음과 같은 omp 플러그인 매니페스트 필드를 선언합니다.

```json
"omp": {
  "extensions": ["./dist/main.js"]
}
```

`omp plugin link .`는 이 필드를 읽어 `dist/main.js`(빌드 산출물)를 omp 세션에 로드합니다. 따라서 `npm run build`로 `dist/`를 먼저 생성해 두어야 합니다.

### 로드 확인 방법

- `/lsc-preset list`를 실행했을 때 오류 없이 프리셋 목록(또는 "no presets defined" 안내)이 출력되면 `/lsc-preset` 커맨드가 정상 등록된 것입니다.
- `models.yaml`에 활성 프리셋이 설정되어 있는 상태로 세션을 시작하면, `src/main.ts`의 `session_start` 핸들러가 `lets-craft: preset "..." active (N agent override(s)).`라는 알림을 띄웁니다. 프리셋이 없으면 이 알림은 뜨지 않습니다(정상 동작).
- `models.yaml`이 손상되어 있어도 세션 시작 자체는 절대 막히지 않고, `lets-craft: could not apply model preset — ...` 경고만 표시됩니다.

## 구성 요소

### 에이전트 7종

각 에이전트는 `agents/lsc-*.md`에 프런트매터(`name`/`description`/`tools`/`spawns`)와 행동 계약으로 정의되어 있습니다.

| 에이전트 | 역할 |
|---|---|
| `lsc-explore` | 읽기 전용 코드베이스 검색 — 파일/코드 패턴/관계를 찾아 즉시 활용 가능한 결과를 반환 |
| `lsc-tracer` | 증거 기반 원인 추적 — 경쟁 가설, 찬반 증거, 불확실성 추적과 다음 탐침 추천 |
| `lsc-critic` | 계획/코드 리뷰 최종 품질 게이트 — 4단계 판정을 내리는 다관점 구조적 리뷰 |
| `lsc-architect` | 전략적 아키텍처·디버깅 자문 — 읽기 전용 코드 분석, 근본 원인 진단, 트레이드오프 포함 권고 |
| `lsc-executor` | 집중형 구현 실행자 — 지정된 작업을 최소 변경으로 구현하고 빌드/테스트를 검증 |
| `lsc-planner` | 확정된 spec을 실행 가능한 계획으로 전환 — DR(합의 요약)과 ADR을 포함, 코드는 절대 작성하지 않음 |
| `lsc-test-engineer` | 테스트 전략·유닛/통합/e2e 작성, 플레이키 테스트 보강, TDD 강제 |

### 스킬 3종

`skills/{pre-craft,craft,post-craft}/SKILL.md`로 정의됩니다.

- **pre-craft**: `trace → interview → plan → test` 4단계를 고정 순서로 실행해 `.lsc/crafts/{feature}/`에 `trace.md`/`spec.md`/`plan.md`/`test/`를 생성합니다. 구현 코드는 절대 작성하지 않고, 마지막에 `craft` 실행을 안내하는 핸드오프 메시지로 끝납니다.
- **craft**: pre-craft 산출물(또는 post-craft의 `audit/audit-N.md`)을 입력으로, `lsc-executor` 스폰 → 해시 검증 → 테스트 실행을 `run_test.sh`가 통과할 때까지 반복하는 루프를 직접 소유합니다. `.lsc/crafts/{feature}/test/`는 절대 직접 수정하지 않습니다.
- **post-craft**: 완성된 구현을 `trace.md`/`spec.md`/`plan.md`에 대해 적대적으로 검증하고 4단계 판정을 `.lsc/crafts/{feature}/audit/audit-N.md`에 기록한 뒤, 판정에 따라 craft 재호출을 제안하거나(사용자 승인 시) 병합·워크트리 정리를 진행합니다.

### `/lsc-preset` 커맨드

`src/preset/command.ts`가 등록하는 대화형 모델 프리셋 관리 커맨드입니다.

```
/lsc-preset list                    # 유효 프리셋(전역+프로젝트 병합) 목록 출력 — 기본 서브액션
/lsc-preset switch|use [name]       # 프리셋 전환, 즉시 세션에 재주입
/lsc-preset create|new [name]       # 7개 에이전트를 순회하며 대화형으로 새 프리셋 생성
/lsc-preset edit [name]             # 기존 프리셋 수정
/lsc-preset delete|rm [name]        # 프리셋 삭제
```

모든 서브액션에 `--project` 플래그를 붙이면 전역(`~/.omp/.lsc/models.yaml`) 대신 프로젝트(`<cwd>/.lsc/models.yaml`)를 대상으로 합니다. `switch`/`create`/`edit`/`delete`는 실행 즉시 현재 세션에 재주입되어 재시작 없이 반영됩니다.

### RULE

`rules/lets-craft.md`(`alwaysApply: true`)는 pre-craft/craft/post-craft 어느 단계에서든 항상 적용되는 세션 규칙입니다.

1. **서브에이전트 위임 적극화**: 읽기 전용 조사는 `lsc-explore`, 원인 설명은 `lsc-tracer`, 계획/diff 리뷰는 `lsc-critic`, 아키텍처 진단은 `lsc-architect`, 구현은 `lsc-executor`, 계획 수립은 `lsc-planner`, 테스트 전략은 `lsc-test-engineer`로 위임합니다.
2. **기능 단위 커밋**: 하나의 커밋은 하나의 논리적 작업 단위(파이프라인 한 단계의 산출물, 프리미티브 하나, 버그 하나, 테스트 스위트 하나)만 담아야 하며, 여러 관심사를 섞은 대규모 커밋을 금지합니다.
3. **커밋 메시지 형식**: 한국어 제목 + conventional-commit 접두사(`feat:`/`fix:`/`chore:`/`docs:`/`refactor:`/`test:` 등) + `what:`/`why:`/`evidence:`/`verify:` 4개 섹션으로 구성된 본문을 요구합니다. `evidence:`/`verify:`를 placeholder로 채우는 것은 금지됩니다.

### 강제 도구

`src/craft/*.ts`, `src/ask.ts`가 등록하는, 사용자가 실제로 마주치는 도구들입니다.

- **`lsc_craft_init`**: craft 루프 시작 시 한 번만 호출됩니다. `.lsc/crafts/{feature}/test/`(run_test.sh + 테스트 자산, `logs/`는 제외)의 SHA-256 해시 매니페스트를 기록하고, 이 feature를 "활성 craft"로 등록해 해시 보호와 중단 방지 백스톱을 켭니다.
- **`lsc_verify_hash`**: 매 실행 반복 후, 테스트 자산이 기록된 해시와 여전히 일치하는지 재확인합니다. 위반 시 어떤 경로가 추가/삭제/수정되었는지 함께 보고합니다.
- **`lsc_run_tests`**: `run_test.sh`를 LLM 자신의 bash 도구가 아니라 신뢰된 실행기(`pi.exec`)로 실행합니다. 전체 실행 로그를 `test/logs/run-N.log`에 저장하고, 통과/실패 여부와 실패 라인 요약을 반환합니다.
- **`lsc_ask` / `lsc_select` / `lsc_confirm`**: 파이프라인이 사람에게 무언가를 물어볼 때 사용하는 유일한 통로입니다(자유 텍스트 / 객관식 / 예-아니오). 대화형 UI가 없는 헤드리스 모드에서 `LSC_FIXTURE`가 설정되지 않으면 이 도구들은 답을 추측하지 않고 즉시 오류로 실패합니다.
- **`lsc_craft_abort`**: craft 루프를 사용자 의사로 중단시키는 유일한 출구입니다. 해시 위반 복구를 사용자가 거부했거나 `run_test.sh` 실행 불가 상황에서 계속 진행을 거부했을 때만 호출되며, 이후 중단 방지 백스톱이 더 이상 세션을 강제로 이어가지 않습니다.

## model preset 사용법

### `models.yaml` 스키마

```yaml
active: fast-triage
presets:
  fast-triage:
    explore: provider-a/model-x:medium
    tracer:  provider-b/model-y:xhigh
```

- `active`: 현재 활성 프리셋 이름(문자열) 또는 `null`.
- `presets`: 프리셋 이름 → (에이전트 짧은 이름 → 모델 문자열) 맵.
- 에이전트 짧은 이름은 7개 고정값입니다: `explore`, `tracer`, `critic`, `architect`, `executor`, `planner`, `test-engineer`. 내부적으로 `lsc-` 접두사가 붙어 실제 등록된 서브에이전트 이름(예: `executor` → `lsc-executor`)에 매핑됩니다.

### 전역 + 프로젝트 오버레이

- 전역: `~/.omp/.lsc/models.yaml`
- 프로젝트: `<cwd>/.lsc/models.yaml`

두 파일을 병합해서 사용하며, **프로젝트 레이어가 우선**합니다. 병합은 프리셋 이름 단위로 이루어지고, 같은 프리셋 안에서는 에이전트 키 단위로 프로젝트 값이 전역 값을 덮어씁니다. `active`도 프로젝트 값이 설정되어 있으면 그 값을 우선 사용합니다.

### effort 문법

모델 문자열은 `provider/model-id[:effort]` 형식입니다. `:effort` 접미사는 다음 5단계 중 하나여야 합니다: `minimal`, `low`, `medium`, `high`, `xhigh`.

### 미지정 시 동작

프리셋에 값이 없는 에이전트는 세션(메인) 모델로 폴백합니다.

### 검증 정책 — 경고 + fallback

`validatePreset`(`src/preset/validate.ts`)은 프리셋의 각 항목에 대해:

- `:effort` 접미사가 있는데 5개 유효 레벨에 속하지 않으면 → 경고를 남기고 해당 에이전트는 세션 모델로 폴백.
- base 모델(`provider/model-id`)이 인증된 모델 목록에서 확인되지 않으면 → 경고를 남기고 해당 에이전트는 세션 모델로 폴백.

즉, 프리셋 항목 하나가 잘못되었다고 해서 세션 시작이나 파이프라인 전체가 실패하지 않고, 문제가 된 에이전트만 조용히 폴백하면서 경고 알림만 표시됩니다.

## 워크플로 가이드

### 1. pre-craft 실행

`"pre-craft"` / `/pre-craft`라고 말하거나, 새 기능/버그를 조사·계획해달라고 요청하면 트리거됩니다.

1. **Stage 0 초기화**: feature 이름(kebab-case)을 결정하고, `--worktree` 사용 여부를 확인한 뒤 `.lsc/crafts/{feature}/`를 만들고, 저장소의 브랜치 네이밍 규칙을 감지해 브랜치(또는 워크트리)를 생성합니다.
2. **Stage 1 trace**: 코드 경로/설정·환경/측정-아티팩트 3개 레인(이상)으로 `lsc-tracer`를 병렬 스폰하고, 외부 리서치(라이브 모드에서는 실제 웹 조사, 픽스처 모드에서는 스텁)를 함께 진행해 `trace.md`를 씁니다.
3. **Stage 2 interview**: `trace.md`의 3개 항목(초기 아이디어 보강/코드베이스 컨텍스트/첫 질문)을 주입받아 시작하고, 모호도(ambiguity) 점수가 5% 미만으로 떨어질 때까지 한 라운드에 한 질문씩 진행해 `spec.md`를 씁니다.
4. **Stage 3 plan**: `lsc-planner`가 작성 → `lsc-architect` → `lsc-critic` 순서의 합의 루프(최대 10회 반복)를 거쳐 ADR을 포함한 `plan.md`를 확정합니다.
5. **Stage 4 test**: `unit`/`integration`/`full-e2e`/`regression` 4종 이상의 `lsc-test-engineer`를 스폰해 `.lsc/crafts/{feature}/test/`(단일 진입점 `run_test.sh`)를 만들고, plan과 동일한 architect/critic 합의 루프를 거칩니다.
6. 네 산출물을 커밋하고, `craft` 실행을 안내하는 핸드오프 질문으로 끝납니다.

### 2. craft 실행

`"craft"` / `/craft`라고 말하거나 `.lsc/crafts/{feature}/`(혹은 `audit/audit-N.md`) 경로를 전달하면 트리거됩니다. `lsc_craft_init` 한 번 호출 후, `lsc-executor` 스폰 → `lsc_verify_hash` → `lsc_run_tests` 순서를 `run_test.sh`가 통과할 때까지(또는 사용자가 `lsc_craft_abort`로 중단할 때까지) 반복합니다.

### 3. post-craft 실행

`"post-craft"` / `/post-craft`라고 말하면 트리거됩니다. `lsc-explore`(코드 매핑)와 `lsc-critic`(적대적 리뷰)를 병렬 스폰하고, spec/plan 컴플라이언스 매트릭스를 직접 확인한 뒤, 테스트를 재실행해 4단계 판정을 `audit/audit-N.md`에 기록합니다.

- `REJECT` / `APPROVE-WITH-CHANGE` → craft를 감사 문서 경로로 재호출하도록 제안.
- `APPROVE` / `APPROVE-WITH-COMMENT` → 사용자에게 명시적 병합 승인을 요청한 뒤(`git merge`는 이 승인 없이는 절대 실행되지 않음) 병합하고, 워크트리를 사용했다면 정리(`git worktree remove` + `git worktree prune`)합니다.

### `--worktree` 옵션

pre-craft Stage 0에서 확인하며, 사용 시 `.lsc/worktrees/{feature}/`에 별도 git worktree를 만들고 `.gitignore`에 `.lsc/worktrees/`를 자동으로 등록합니다. craft는 이 워크트리를 구현 루트로 사용하고, post-craft의 land 단계에서 병합 후 정리됩니다.

### 산출물 디렉터리 구조

```
<프로젝트 루트>/
└── .lsc/
    ├── crafts/
    │   └── {feature}/
    │       ├── trace.md              # pre-craft Stage 1
    │       ├── research/             # 외부 리서치 세션 (라이브 모드)
    │       ├── spec.md               # pre-craft Stage 2
    │       ├── plan.md               # pre-craft Stage 3
    │       ├── test/
    │       │   ├── run_test.sh       # 단일 진입점, craft 시작 시 해시 보호됨
    │       │   ├── logs/
    │       │   │   └── run-N.log     # lsc_run_tests 실행 로그 (해시 보호 제외)
    │       │   ├── .hash-manifest.json   # lsc_craft_init이 기록 (해시 보호 제외)
    │       │   └── .craft-state.json     # 재시작 durable craft 상태 (해시 보호 제외)
    │       └── audit/
    │           └── audit-{N}.md      # post-craft 감사 결과 (N은 0부터)
    └── worktrees/
        └── {feature}/                # --worktree 사용 시에만 생성, .gitignore에 자동 등록

~/.omp/.lsc/
└── models.yaml                       # 전역 모델 프리셋

<프로젝트 루트>/.lsc/models.yaml       # 프로젝트 모델 프리셋 (전역보다 우선)
```

## 강제 규칙 설명

craft 루프가 활성화되어 있는 동안, 아래 세 가지는 LLM의 협조 여부와 무관하게 플랫폼 레벨에서 강제됩니다(`src/craft/enforcement.ts`).

### 1. 테스트 수정 차단

`write`/`edit`/`ast_edit` 도구가 활성 craft의 보호된 `.lsc/crafts/{feature}/test/` 경로(또는 그 아래 경로)를 대상으로 호출되면 `tool_call` 훅이 `{block: true, reason: ...}`를 반환해 즉시 차단됩니다. `bash` 도구는 임의의 셸 명령을 완전히 파싱할 수 없으므로, 명령 문자열이나 지정된 작업 디렉터리에 보호된 테스트 경로 문자열이 포함되어 있으면 보수적으로(fail-closed) 차단합니다. 사용자가 이 동작을 마주치는 이유: craft가 "테스트를 고쳐서 통과시키는" 지름길을 원천적으로 막기 위함입니다.

### 2. 해시 불변성

`lsc_craft_init`이 `test/`(단, `logs/`와 두 상태 파일 제외) 전체 파일의 SHA-256 해시를 기록해 두고, 매 실행 반복 후 `lsc_verify_hash`가 다시 해시를 계산해 비교합니다. 위반(추가/삭제/수정)이 발견되면 craft는 그 반복에서 테스트를 실행하지 않고 즉시 멈춘 뒤, `lsc_confirm`으로 `[Hash Violation] ... Proceed?` 질문을 통해 사용자에게 diff를 보여주고 복구 여부를 묻습니다. 승인 시 `git checkout`/`git clean`으로 테스트 디렉터리만 복구하고 재검증 후 계속 진행하며, 거부 시 `lsc_craft_abort`가 호출되어 루프가 종료됩니다.

### 3. 중단 방지 백스톱

`session_stop` 훅이 활성 craft가 있고(`testsPassed`가 아직 `false`이고 `aborted`도 아닌 상태) 세션이 스스로 멈추려 할 때마다 `{continue: true, additionalContext: ...}`를 반환해 강제로 한 턴을 더 진행시킵니다. 이 강제는 `lsc_run_tests`가 `testsPassed: true`를 기록하거나, 사용자가 명시적으로 거부해 `lsc_craft_abort`가 호출되어야만 해제됩니다. 사용자가 이 동작을 마주치는 이유: "테스트가 통과할 때까지 반복하고, 사용자 중단 외에는 멈추지 않는다"는 craft 루프의 핵심 계약을 세션 자체가 스스로 포기하지 못하게 하기 위함입니다.

> **참고**: 이 백스톱은 **인터랙티브 세션에서 발동**합니다. 비인터랙티브 `-p`(print/1회성) 실행에서는 플랫폼이 텍스트-only 정지 턴에 `session_stop` 훅을 호출하지 않으므로 백스톱이 발동하지 않습니다. craft 루프 자체는 스킬이 소유하므로(`skills/craft/SKILL.md`) 백스톱 없이도 정상 동작하며, 백스톱은 세션이 스스로 조기 중단하는 것을 막는 보조장치입니다.

## 테스트/검증

### `npm test` — 유닛 테스트

```bash
npm test   # vitest run
```

`test/**/*.test.ts`를 대상으로 하며, `node_modules/`, `dist/`, 벤더 트리, `fixtures/**`는 명시적으로 제외됩니다(`vitest.config.ts`). E2E 테스트 파일(`e2e-full-cycle.test.ts`, `e2e-worktree.test.ts`, `enforcement-rules.test.ts`)은 `LSC_E2E` 환경변수가 없으면 `describe.skipIf`로 전부 스킵되므로, `npm test`는 실제 omp 프로세스나 실제 토큰을 전혀 건드리지 않습니다.

### `npm run e2e` — 실제 omp 통합 E2E

```bash
npm run e2e
# 내부적으로: npm run build && LSC_E2E=1 vitest run \
#   test/e2e-full-cycle.test.ts test/e2e-worktree.test.ts test/enforcement-rules.test.ts \
#   --no-file-parallelism --testTimeout=10200000 --hookTimeout=120000
```

**경고 — 실제 토큰을 소비합니다.** 이 3개 파일은 실제 `omp` 바이너리를 헤드리스(`-p --mode=json`)로 자식 프로세스로 구동하며, 실제로 인증된 provider에 대해 실제 API 호출을 발생시킵니다. `--no-file-parallelism`으로 파일 간 동시 실행을 막고, 테스트당 최대 170분(`testTimeout=10200000`ms), 훅당 최대 2분(`hookTimeout=120000`ms)의 타임아웃이 걸려 있습니다. 각 테스트 파일 내부에도 단계별(pre-craft/craft/post-craft) 독립적인 kill 타임아웃이 별도로 걸려 있어, 멈추거나 반복하는 모델이 하네시 전체를 무한정 붙잡지 못하도록 되어 있습니다.

- `test/e2e-full-cycle.test.ts`: pre-craft → craft → post-craft 전체를 픽스처 샘플에 대해 구동해, `trace.md → spec.md → plan.md → test/`가 순서대로 생성되고 craft 이후 `run_test.sh`가 통과하며 `audit-0.md`에 판정 라인이 기록되는지 확인합니다. 트레이스 추론의 질이나 spec 모호도 계산의 정확성 같은 의미론적 판단은 검증하지 않고, 산출물 존재/작성 순서/문자 그대로의 감사 판정 라인만 확인합니다.
- `test/e2e-worktree.test.ts`: `--worktree` 경로(워크트리 생성, `.gitignore` 등록, craft가 워크트리를 구현 루트로 사용, land 시 병합+정리)를 검증합니다.
- `test/enforcement-rules.test.ts`: `tool_call` 차단, 해시 위반 에스컬레이션, `session_stop` 백스톱 세 가지 강제 메커니즘의 실제 omp 연동(순수 판정 함수 자체는 별도 유닛 테스트로 이미 커버됨)을 검증합니다.

### `LSC_FIXTURE` 응답 주입 모드

pre-craft/craft/post-craft가 사람에게 묻는 모든 질문은 `lsc_ask`/`lsc_select`/`lsc_confirm`을 거칩니다. `LSC_FIXTURE=<answers.json 경로>` 환경변수(또는 `--lsc-fixtures` 플래그)가 설정되면, 이 도구들은 대화형 UI 대신 스크립트된 응답을 반환해 파이프라인 전체를 무인(unattended)으로 실행할 수 있게 합니다.

`answers.json` 스키마:

```json
{
  "default": "yes",
  "answers": [
    { "match": "^\\[Feature Name\\]", "response": "...", "once": false, "optionIndex": 0 }
  ]
}
```

- `match`: 질문 문자열에 대해 먼저 대소문자 무시 정규식으로 시도하고, 유효한 정규식이 아니면 대소문자 무시 부분 문자열 검사로 폴백합니다.
- `response`: 스크립트된 응답. `lsc_select`의 경우 정확 일치 → 대소문자 무시 일치 → 유일한 단어 단위 포함 매칭 순으로 옵션 라벨에 매칭을 시도합니다.
- `once`: `true`면 한 번 매칭된 후 그 규칙은 소진되어 다시 매칭되지 않습니다.
- `optionIndex`: `lsc_select` 전용 — 텍스트 매칭이 실패했을 때 `options[optionIndex]`를 직접 선택하는 탈출구입니다.
- `default`: 어떤 규칙도 매칭되지 않았을 때의 폴백 응답. 이것도 없으면 무한 대기 대신 즉시 에러로 실패합니다.

번들된 샘플 픽스처는 `fixtures/sample-ts-cli/`입니다. 의존성 없는 `node --test` 기반의 최소 TypeScript CLI 프로젝트로, `slugify()`에 의도적인 버그(연속된 구분자를 하나로 합치지 못함)가 남아 있어 craft 루프가 실제로 반복 수정할 거리가 있습니다. `answers.json`(인터뷰 응답 스크립트), `recorded-research.md`(픽스처 모드에서 외부 웹 리서치 대신 읽어들이는 사전 기록 리서치), `run_test.sh`(`node --test`를 실행하고 결과를 요약하는 단일 진입점)를 포함합니다.

## dogfooding 절차

`lets-craft`는 임의의 git 저장소를 대상으로 동작하도록 설계되어 있으므로, 이 저장소 자신에도 동일하게 적용할 수 있습니다. v1 완성 이후 이어지는 기능 개발은, 다른 프로젝트에 `lets-craft`를 적용할 때와 동일한 절차를 이 저장소 자체에 대해 수행하는 것으로 진행합니다.

1. 이 저장소에서 `omp plugin link .`로 플러그인이 로드된 상태를 유지합니다(설치 절차와 동일).
2. 다음 기능/개선 아이디어를 `"pre-craft"`로 시작해, `.lsc/crafts/{feature}/`에 `trace.md → spec.md → plan.md → test/`를 생성합니다. 이때 조사·계획·테스트 작성 대상은 `lets-craft` 자기 자신의 `src/`, `agents/`, `skills/`, `rules/`입니다.
3. `"craft"`로 구현 루프를 돌려 `run_test.sh`(즉 `npm test`, 그리고 필요시 `npm run e2e`)가 통과할 때까지 반복합니다. 이 과정에서도 해시 불변성·중단 방지 백스톱 등 강제 규칙이 동일하게 적용됩니다.
4. `"post-craft"`로 적대적 감사를 거쳐 판정을 기록하고, 승인 시 병합합니다.

이 저장소에는 위 절차를 거쳐 생성된 `.lsc/crafts/` 산출물이 아직 커밋되어 있지 않습니다(v1 자체는 이 파이프라인이 완성되기 전에 별도로 구현되었습니다) — 다음 기능부터 이 절차를 실제로 적용하는 것이 dogfooding의 첫걸음입니다.

## 라이선스

`package.json`은 `"license": "MIT"`를 선언하고 있습니다. 이 저장소에는 별도의 `LICENSE` 파일이 아직 포함되어 있지 않습니다.
