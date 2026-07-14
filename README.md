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
- `models.yaml`에 활성 프리셋이 설정되어 있는 상태로 세션을 시작하면, `src/main.ts`의 `session_start` 핸들러가 `lets-craft: preset "..." active (N agent override(s)).`라는 알림을 띄웁니다. 유효한 `default`가 신규 메인 세션에 적용되면 `lets-craft: session model -> ...` 알림도 표시됩니다. 프리셋이 없으면 이 알림들은 뜨지 않습니다(정상 동작).
- `models.yaml`이 손상되어 있어도 세션 시작 자체는 절대 막히지 않고, `lets-craft: could not apply model preset — ...` 경고만 표시됩니다.

## 구성 요소

### 에이전트 8종

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
| `lsc-librarian` | 외부 라이브러리/API/생태계 리서치 전문 — 로컬 의존성(설치된 패키지 소스·타입 정의) 우선 확인 후 필요 시 클론/웹 검색, 모든 주장을 소스/공식문서로 근거화한 구조화된 결과(answer/sources/api/version)를 반환 |

### 스킬 3종

`skills/{pre-craft,craft,post-craft}/SKILL.md`로 정의됩니다.

- **pre-craft**: `trace → interview → plan → test` 4단계를 고정 순서로 실행해 `.lsc/crafts/{feature}/`에 `trace.md`/`spec.md`/`plan.md`/`test/`를 생성합니다. 구현 코드는 절대 작성하지 않고, 마지막에 `craft` 실행을 안내하는 핸드오프 메시지로 끝납니다.
- **craft**: pre-craft 산출물(또는 post-craft의 `audit/audit-N.md`)을 입력으로, `lsc-executor` 스폰 → 해시 검증 → 테스트 실행을 `run_test.sh`가 통과할 때까지 반복하는 루프를 직접 소유합니다. `.lsc/crafts/{feature}/test/`는 절대 직접 수정하지 않습니다.
- **post-craft**: 완성된 구현을 `trace.md`/`spec.md`/`plan.md`에 대해 적대적으로 검증하고 4단계 판정을 `.lsc/crafts/{feature}/audit/audit-N.md`에 기록한 뒤, 판정에 따라 craft 재호출을 제안하거나(사용자 승인 시) 병합·워크트리 정리를 진행합니다.

### `/lsc-preset` 커맨드

`src/preset/command.ts`가 등록하는 대화형 모델 프리셋 관리 커맨드입니다.

```
/lsc-preset list                    # 유효 프리셋(전역+프로젝트 병합) 목록 출력 — 기본 서브액션
/lsc-preset switch|use [name]       # 프리셋 전환, 에이전트 override와 세션 default 즉시 적용
/lsc-preset create|new [name]       # 세션 default를 먼저 묻고(skip 가능), 8개 에이전트를 순회해 생성
/lsc-preset edit [name]             # 같은 질문 순서로 수정(default는 즉시 재적용하지 않음)
/lsc-preset delete|rm [name]        # 프리셋 삭제(default 모델 복원 없음)
```

모든 서브액션에 `--project` 플래그를 붙이면 전역(`~/.omp/.lsc/models.yaml`) 대신 프로젝트(`<cwd>/.lsc/models.yaml`)를 대상으로 합니다. 에이전트 override는 변경 후 현재 세션에 재주입됩니다. 세션 `default`는 명시적 `switch`에서 즉시 적용되고, `create`는 생성한 프리셋이 동시에 자동 활성화될 때만 즉시 적용됩니다. `edit`/`delete`는 사용자가 `/model`로 고른 현재 모델을 덮어쓰지 않습니다.

### RULE

`rules/lets-craft.md`(`alwaysApply: true`)는 pre-craft/craft/post-craft 어느 단계에서든 항상 적용되는 세션 규칙입니다.

1. **서브에이전트 위임 적극화**: 읽기 전용 조사는 `lsc-explore`, 원인 설명은 `lsc-tracer`, 계획/diff 리뷰는 `lsc-critic`, 아키텍처 진단은 `lsc-architect`, 구현은 `lsc-executor`, 계획 수립은 `lsc-planner`, 테스트 전략은 `lsc-test-engineer`, 외부 라이브러리/API 리서치는 `lsc-librarian`으로 위임합니다.
2. **기능 단위 커밋**: 하나의 커밋은 하나의 논리적 작업 단위(파이프라인 한 단계의 산출물, 프리미티브 하나, 버그 하나, 테스트 스위트 하나)만 담아야 하며, 여러 관심사를 섞은 대규모 커밋을 금지합니다.
3. **커밋 메시지 형식**: 한국어 제목 + conventional-commit 접두사(`feat:`/`fix:`/`chore:`/`docs:`/`refactor:`/`test:` 등) + `what:`/`why:`/`evidence:`/`verify:` 4개 섹션으로 구성된 본문을 요구합니다. `evidence:`/`verify:`를 placeholder로 채우는 것은 금지됩니다.

### 강제 도구

`src/craft/*.ts`, `src/ask.ts`가 등록하는, 사용자가 실제로 마주치는 도구들입니다.

- **`lsc_craft_init`**: craft 루프 시작 시 한 번만 호출됩니다. `.lsc/crafts/{feature}/test/`(run_test.sh + 테스트 자산, `logs/`는 제외)의 SHA-256 해시 매니페스트를 기록하고, 이 feature를 "활성 craft"로 등록해 해시 보호와 중단 방지 백스톱을 켭니다.
- **`lsc_verify_hash`**: 매 실행 반복 후, 테스트 자산이 기록된 해시와 여전히 일치하는지 재확인합니다. 위반 시 어떤 경로가 추가/삭제/수정되었는지 함께 보고합니다.
- **`lsc_run_tests`**: `run_test.sh`를 LLM 자신의 bash 도구가 아니라 신뢰된 실행기(`pi.exec`)로 실행합니다. 전체 실행 로그를 `test/logs/run-N.log`에 저장하고, 통과/실패 여부와 실패 라인 요약을 반환합니다.
- **`lsc_ask` / `lsc_select` / `lsc_confirm`**: 파이프라인이 사람에게 무언가를 물어볼 때 사용하는 유일한 통로입니다(자유 텍스트 / 객관식 / 예-아니오). 대화형 UI가 없는 헤드리스 모드에서 `LSC_FIXTURE`가 설정되지 않으면 이 도구들은 답을 추측하지 않고 즉시 오류로 실패합니다.
- **`lsc_craft_abort`**: craft 루프를 사용자 의사로 중단시키는 유일한 출구입니다. 해시 위반 복구를 사용자가 거부했거나 `run_test.sh` 실행 불가 상황에서 계속 진행을 거부했을 때만 호출되며, 이후 중단 방지 백스톱이 더 이상 세션을 강제로 이어가지 않습니다.
- **`lsc_craft_release`**: 감사(post-craft)가 보호된 test 캐논 자체의 의도적 수정을 요구하는 상황을 위한 승인 경로입니다. 반드시 `lsc_confirm`을 통한 사용자 승인 후에만 호출되어야 하며, 호출 즉시 해시 보호가 해제됩니다. 캐논을 수정한 뒤에는 `lsc_craft_init`을 다시 호출해 매니페스트를 재기록해야만 해시 보호와 중단 방지 백스톱이 다시 켜집니다 — 재호출을 생략하면 보호 없이 루프가 계속됩니다.

## model preset 사용법

### `models.yaml` 스키마

```yaml
active: fast-triage
presets:
  fast-triage:
    default: provider-a/model-session:high
    agents:
      explore: provider-a/model-x:medium
      tracer:  provider-b/model-y:xhigh
```

- `active`: 현재 활성 프리셋 이름(문자열) 또는 `null`.
- `presets`: 프리셋 이름 → 구조형 엔트리 맵.
- `default`(선택): omp 세션 메인 모델 `provider/model-id[:effort]`.
- `agents`: 에이전트 짧은 이름 → 모델 문자열 맵. 짧은 이름은 `explore`, `tracer`, `critic`, `architect`, `executor`, `planner`, `test-engineer`, `librarian` 8개이며, 내부적으로 `lsc-` 접두사가 붙습니다(예: `executor` → `lsc-executor`).

기존의 평면 형식(`fast-triage: { explore: ..., tracer: ... }`)도 **agents-only** 프리셋으로 계속 읽습니다. 평면 맵의 `default`/`agents` 키는 에이전트 이름으로 사용하지 않고 경고 후 버리므로 세션 default는 반드시 위 구조형 sibling 필드로 작성해야 합니다. `switch`/`create`/`edit`/`delete`로 파일을 저장하면 구조형으로 업그레이드되며, v0.1.0에서는 이 파일을 구버전 lets-craft가 다시 읽지 못할 수 있습니다.

### 전역 + 프로젝트 오버레이

- 전역: `~/.omp/.lsc/models.yaml`
- 프로젝트: `<cwd>/.lsc/models.yaml`

두 파일을 병합해서 사용하며, **프로젝트 레이어가 우선**합니다. 같은 프리셋 안에서 `agents`는 에이전트 키 단위로 프로젝트 값이 전역 값을 덮어씁니다. `default`는 프로젝트 값이 전역 값을 덮어쓰며, 프로젝트가 생략하면 전역 값을 상속합니다. 이번 버전에서는 프로젝트 레이어로 전역 `default`를 삭제(erase)하는 기능은 지원하지 않습니다. `active`도 프로젝트 값이 설정되어 있으면 우선합니다.

### effort 문법

`default`와 에이전트 모델 문자열은 `provider/model-id[:effort]` 형식입니다. `:effort` 접미사는 `minimal`, `low`, `medium`, `high`, `xhigh`, `max` 중 하나여야 합니다. 세션 default에 effort가 있으면 모델 전환 성공 뒤 thinking level도 함께 설정하고, 접미사가 없으면 현재 thinking level을 유지합니다. 콜론을 포함한 전체 스펙(`provider/model-id:max` 등)이 그 자체로 인증된 모델로 바로 resolve되면, 접미사를 effort로 분리하지 않고 리터럴 모델 ID로 취급합니다.

### 미지정 시 동작

프리셋에 값이 없는 에이전트는 세션(메인) 모델로 폴백합니다. 활성 프리셋에 `default`가 있으면 세션 메인 모델 자체가 그 값으로 전환되므로 미지정 에이전트도 결과적으로 프리셋 default를 따릅니다.

### 세션 default 모델

- 명시적 `/lsc-preset switch`는 즉시 세션 모델을 전환합니다. `create`는 활성 프리셋이 없어서 새 프리셋이 자동 활성화된 경우에만 즉시 전환합니다.
- 자동 적용은 **프로세스 부팅으로 만들어진 신규 메인 세션**의 `session_start`에서만 일어납니다. `/new`, 세션 전환, 세션 브랜치는 `session_start`를 다시 발화하지 않으므로 다음 명시적 switch 또는 새 프로세스 부팅 전까지 자동 적용하지 않습니다.
- resume, 서브에이전트 세션, 세션 중 수동 `/model` 또는 모델 사이클 선택에는 간섭하지 않습니다. `edit`/`delete`도 default를 재적용하지 않으며, default 없는 프리셋으로 전환하거나 프리셋을 해제해도 이전 모델을 복원하지 않고 현재 모델을 유지합니다.
- 모델을 해석할 수 없거나 API key가 없으면 프리셋 활성화와 에이전트 override는 유지한 채 default 전환만 경고 후 건너뜁니다. 자동 게이트가 default를 건너뛴 원인을 진단하려면 `LSC_DEBUG=1`로 실행하십시오. stderr에 세션 엔트리 타입 히스토그램 한 줄을 출력합니다.

### 검증 정책 — 경고 + fallback

`validatePreset`(`src/preset/validate.ts`)은 session default와 각 에이전트 항목의 형식, effort, 인증된 모델 해석 가능 여부를 확인합니다. 잘못된 default는 현재 세션 모델을 유지하고, 잘못된 에이전트 항목은 해당 에이전트만 세션 모델로 폴백합니다. 어느 경우에도 세션 시작이나 파이프라인 전체를 실패시키지 않고 경고 알림만 표시합니다.

## 워크플로 가이드

### 1. pre-craft 실행

`"pre-craft"` / `/pre-craft`라고 말하거나, 새 기능/버그를 조사·계획해달라고 요청하면 트리거됩니다.

1. **Stage 0 초기화**: feature 이름(kebab-case)을 결정하고, `.lsc/crafts/{feature}/`를 만듭니다. 워크트리 사용 여부를 묻지 않고 항상 저장소의 브랜치 네이밍 규칙을 감지해 `.lsc/worktrees/{feature}/`에 feature 브랜치 워크트리를 생성합니다 — 이후 모든 산출물은 이 워크트리 내부의 `.lsc/crafts/{feature}/`에 작성·커밋되고, 원래(base) 브랜치는 land(병합 승인) 전까지 전혀 건드리지 않습니다.
2. **Stage 1 trace**: 코드 경로/설정·환경/측정-아티팩트 3개 레인(이상)으로 `lsc-tracer`를 병렬 스폰하고, 외부 리서치(라이브 모드에서는 `lsc-librarian` 등을 동원한 실제 웹 조사, 픽스처 모드에서는 스텁)를 함께 진행해 `trace.md`를 씁니다. 완료 시 워크트리의 feature 브랜치에 커밋합니다.
3. **Stage 2 interview**: `trace.md`의 3개 항목(초기 아이디어 보강/코드베이스 컨텍스트/첫 질문)을 주입받아 시작하고, 모호도(ambiguity) 점수가 5% 미만으로 떨어질 때까지 한 라운드에 한 질문씩 진행해 `spec.md`를 씁니다. 완료 시 커밋합니다.
4. **Stage 3 plan**: `lsc-planner`가 작성 → `lsc-architect` → `lsc-critic` 순서의 합의 루프(최대 10회 반복)를 거쳐 ADR을 포함한 `plan.md`를 확정합니다. 매 반복마다 architect와 critic이 모두 실행됩니다 — critic은 architect의 리뷰 전문을 입력으로 받아 참고하지만, 최종 판정(`VERDICT`)은 architect가 blocking으로 판단했는지와 무관하게 독립적으로 내립니다. 완료 시 커밋합니다.
5. **Stage 4 test**: `unit`/`integration`/`full-e2e`/`regression` 4종 이상의 `lsc-test-engineer`를 스폰해 `.lsc/crafts/{feature}/test/`(단일 진입점 `run_test.sh`)를 만들고, plan과 동일한(매 반복 architect+critic 상시 실행) 합의 루프를 거칩니다. 완료 시 커밋합니다.
6. 이렇게 각 단계(research/trace/spec/plan/test) 완료마다 feature 브랜치에 개별 커밋이 쌓입니다(총 5개 이상). 마지막으로 `craft` 실행을 안내하는 핸드오프 질문으로 끝나며, 사용자가 승인하면 같은 세션에서 곧바로 `craft` 스킬로 이어서 진행합니다(자동 체이닝 — `LSC_FIXTURE` 픽스처 모드에서는 이중 실행 방지를 위해 비활성화되고, 거부 시 `craft`를 수동으로 다시 호출하라는 안내만 표시됩니다).

### 2. craft 실행

`"craft"` / `/craft`라고 말하거나 `.lsc/crafts/{feature}/`(혹은 `audit/audit-N.md`) 경로를 전달하면 트리거됩니다. pre-craft가 만든 워크트리를 자동으로 감지해 그 안에서 구현을 진행합니다. `lsc_craft_init` 한 번 호출 후, `lsc-executor` 스폰 → `lsc_verify_hash` → `lsc_run_tests` 순서를 `run_test.sh`가 통과할 때까지(또는 사용자가 `lsc_craft_abort`로 중단할 때까지) 반복합니다. 완료하면 사용자 승인 시 같은 세션에서 곧바로 `post-craft`로 이어집니다(자동 체이닝, pre-craft와 동일 규칙).

### 3. post-craft 실행

`"post-craft"` / `/post-craft`라고 말하면 트리거됩니다. `lsc-explore`(코드 매핑)와 `lsc-critic`(적대적 리뷰)를 병렬 스폰하고, spec/plan 컴플라이언스 매트릭스를 직접 확인한 뒤, 테스트를 재실행해 4단계 판정을 워크트리 내부의 `audit/audit-N.md`에 기록합니다.

- `REJECT` / `APPROVE-WITH-CHANGE` → craft를 감사 문서 경로로 재호출하도록 제안(사용자 승인 시 자동 체이닝). 감사가 보호된 test 캐논 자체의 수정을 요구하는 특수한 경우에는, `lsc_confirm` 승인 후 `lsc_craft_release`로 해시 보호를 해제하고 캐논을 수정한 뒤 `lsc_craft_init`을 재호출해 다시 보호를 켜는 경로를 사용합니다.
- `APPROVE` / `APPROVE-WITH-COMMENT` → 사용자에게 명시적 병합 승인을 요청한 뒤(`git merge`는 이 승인 없이는 절대 실행되지 않음) feature 브랜치를 base 브랜치로 `--no-ff` 병합하고, 워크트리를 정리(`git worktree remove` + `git worktree prune`)합니다. 병합 전까지 base 브랜치는 이 feature의 산출물·구현·감사 어느 것도 담고 있지 않습니다.

### 항상 워크트리 (all-in-worktree)

pre-craft는 사용자에게 워크트리 사용 여부를 묻지 않고, 모든 feature에 대해 무조건 `.lsc/worktrees/{feature}/`에 git worktree를 만들고 `.gitignore`에 `.lsc/worktrees/`를 자동으로 등록합니다. trace/spec/plan/test(pre-craft)와 구현(craft), 감사(post-craft)까지 파이프라인 전체가 이 워크트리 내부의 `.lsc/crafts/{feature}/`에서만 진행되며, 원래(base) 브랜치는 post-craft의 land 단계에서 명시적으로 병합 승인하기 전까지 완전히 무오염 상태로 유지됩니다. land가 완료되면 워크트리는 제거되고, 산출물·구현·감사가 base 브랜치에 병합되어 나타납니다.

### 산출물 디렉터리 구조

land(병합) 전까지, 모든 feature 산출물은 base 브랜치가 아니라 워크트리 내부에 존재합니다.

```
<프로젝트 루트>/                        # base 브랜치 체크아웃 — land 전까지 이 feature에 대해 무오염
└── .lsc/
    └── worktrees/                     # .gitignore에 자동 등록, 항상 생성
        └── {feature}/                 # feature 브랜치 워크트리
            └── .lsc/
                └── crafts/
                    └── {feature}/
                        ├── trace.md            # pre-craft Stage 1
                        ├── research/           # 외부 리서치 세션 (라이브 모드)
                        ├── spec.md             # pre-craft Stage 2
                        ├── plan.md             # pre-craft Stage 3
                        ├── test/
                        │   ├── run_test.sh     # 단일 진입점, craft 시작 시 해시 보호됨
                        │   ├── logs/
                        │   │   └── run-N.log   # lsc_run_tests 실행 로그 (해시 보호 제외)
                        │   ├── .hash-manifest.json   # lsc_craft_init이 기록 (해시 보호 제외)
                        │   └── .craft-state.json     # 재시작 durable craft 상태 (해시 보호 제외)
                        └── audit/
                            └── audit-{N}.md    # post-craft 감사 결과 (N은 0부터)

land(병합 승인) 후:

<프로젝트 루트>/.lsc/crafts/{feature}/  # --no-ff 병합으로 base 브랜치에 그대로 나타남
                                         # (worktrees/{feature}/는 제거·prune됨)

~/.omp/.lsc/
└── models.yaml                        # 전역 모델 프리셋

<프로젝트 루트>/.lsc/models.yaml        # 프로젝트 모델 프리셋 (전역보다 우선)
```

## 강제 규칙 설명

craft 루프가 활성화되어 있는 동안, 아래 세 가지는 LLM의 협조 여부와 무관하게 플랫폼 레벨에서 강제됩니다(`src/craft/enforcement.ts`).

### 1. 테스트 수정 차단

`write`/`edit`/`ast_edit` 도구가 활성 craft의 보호된 `.lsc/crafts/{feature}/test/` 경로(또는 그 아래 경로)를 대상으로 호출되면 `tool_call` 훅이 `{block: true, reason: ...}`를 반환해 즉시 차단됩니다. `bash` 도구는 임의의 셸 명령을 완전히 파싱할 수 없으므로, 명령 문자열이나 지정된 작업 디렉터리에 보호된 테스트 경로 문자열이 포함되어 있으면 보수적으로(fail-closed) 차단합니다. 사용자가 이 동작을 마주치는 이유: craft가 "테스트를 고쳐서 통과시키는" 지름길을 원천적으로 막기 위함입니다.

### 2. 해시 불변성

`lsc_craft_init`이 `test/`(단, `logs/`와 두 상태 파일 제외) 전체 파일의 SHA-256 해시를 기록해 두고, 매 실행 반복 후 `lsc_verify_hash`가 다시 해시를 계산해 비교합니다. 위반(추가/삭제/수정)이 발견되면 craft는 그 반복에서 테스트를 실행하지 않고 즉시 멈춘 뒤, `lsc_confirm`으로 `[Hash Violation] ... Proceed?` 질문을 통해 사용자에게 diff를 보여주고 복구 여부를 묻습니다. 승인 시 `git checkout`/`git clean`으로 테스트 디렉터리만 복구하고 재검증 후 계속 진행하며, 거부 시 `lsc_craft_abort`가 호출되어 루프가 종료됩니다.

이와 별개로, post-craft의 감사가 보호된 test 캐논 자체의 의도적 수정을 요구하는 경우를 위한 승인 경로가 따로 있습니다: `lsc_confirm` 승인 → `lsc_craft_release`(해시 보호 해제) → 캐논 수정 → `lsc_craft_init` 재호출(매니페스트 재기록, 보호 재활성화). 이 경로 없이는 보호된 test 트리를 의도적으로 고칠 방법이 없습니다.

### 3. 중단 방지 백스톱

`session_stop` 훅이 활성 craft가 있고(`testsPassed`가 아직 `false`이고 `aborted`도 아닌 상태) 세션이 스스로 멈추려 할 때마다 `{continue: true, additionalContext: ...}`를 반환해 강제로 한 턴을 더 진행시킵니다. 이 강제는 `lsc_run_tests`가 `testsPassed: true`를 기록하거나, 사용자가 명시적으로 거부해 `lsc_craft_abort`가 호출되어야만 해제됩니다. 사용자가 이 동작을 마주치는 이유: "테스트가 통과할 때까지 반복하고, 사용자 중단 외에는 멈추지 않는다"는 craft 루프의 핵심 계약을 세션 자체가 스스로 포기하지 못하게 하기 위함입니다.

> **참고**: 이 백스톱은 **인터랙티브 세션에서 발동**합니다. 비인터랙티브 `-p`(print/1회성) 실행에서는 플랫폼이 텍스트-only 정지 턴에 `session_stop` 훅을 호출하지 않으므로 백스톱이 발동하지 않습니다. craft 루프 자체는 스킬이 소유하므로(`skills/craft/SKILL.md`) 백스톱 없이도 정상 동작하며, 백스톱은 세션이 스스로 조기 중단하는 것을 막는 보조장치입니다.

## 테스트/검증

### `npm test` — 유닛 테스트

```bash
npm test   # vitest run
```

`test/**/*.test.ts`를 대상으로 하며, `node_modules/`, `dist/`, 벤더 트리, `fixtures/**`는 명시적으로 제외됩니다(`vitest.config.ts`). E2E 테스트 파일(`e2e-full-cycle.test.ts`, `enforcement-rules.test.ts`, `e2e-preset-default.test.ts`)은 `LSC_E2E` 환경변수가 없으면 `describe.skipIf`로 전부 스킵되므로, `npm test`는 실제 omp 프로세스나 실제 토큰을 전혀 건드리지 않습니다.

### `npm run e2e` — 실제 omp 통합 E2E

```bash
npm run e2e
# 내부적으로: npm run build && LSC_E2E=1 vitest run \
#   test/e2e-full-cycle.test.ts test/enforcement-rules.test.ts test/e2e-preset-default.test.ts \
#   --no-file-parallelism --testTimeout=10200000 --hookTimeout=120000
```

**경고 — 실제 토큰을 소비합니다.** 이 3개 파일은 실제 `omp` 바이너리를 헤드리스(`-p --mode=json`)로 자식 프로세스로 구동하며, 실제로 인증된 provider에 대해 실제 API 호출을 발생시킵니다. `--no-file-parallelism`으로 파일 간 동시 실행을 막고, 테스트당 최대 170분(`testTimeout=10200000`ms), 훅당 최대 2분(`hookTimeout=120000`ms)의 타임아웃이 걸려 있습니다. 각 테스트 파일 내부에도 단계별(pre-craft/craft/post-craft) 독립적인 kill 타임아웃이 별도로 걸려 있어, 멈추거나 반복하는 모델이 하네시 전체를 무한정 붙잡지 못하도록 되어 있습니다.

- `test/e2e-full-cycle.test.ts`: 항상-워크트리 토폴로지로 pre-craft → craft → post-craft → land 전체를 픽스처 샘플에 대해 구동합니다. 워크트리 내부에 `trace.md → spec.md → plan.md → test/`가 순서대로 생성되고, base 브랜치가 그 동안 무오염임(산출물 커밋 0건)을 확인하고, pre-craft 단계별 커밋이 5개 이상 쌓였는지, craft 이후 `run_test.sh`가 통과하는지, `audit-0.md`에 판정 라인이 기록되는지, 마지막으로 승인 가능한 판정에서 워크트리가 base 브랜치로 병합·제거되고 산출물·구현·감사가 base에 나타나는지까지 단계별로 확인합니다. 트레이스 추론의 질이나 spec 모호도 계산의 정확성 같은 의미론적 판단은 검증하지 않고, 산출물 존재/작성 순서/커밋 위상/문자 그대로의 감사 판정 라인만 확인합니다.
- `test/enforcement-rules.test.ts`: `tool_call` 차단, 해시 위반 에스컬레이션, `session_stop` 백스톱, `read` 도구를 통한 보호 트리 조회가 차단되지 않는지, `lsc_craft_release` 승인 경로(해제 → 캐논 수정 → 재init → 재검증 통과)까지 다섯 가지 강제 메커니즘의 실제 omp 연동(순수 판정 함수 자체는 별도 유닛 테스트로 이미 커버됨)을 검증합니다.
- `test/e2e-preset-default.test.ts`: 구조형 프리셋의 세션 default 모델이 세션 시작 시 실제로 적용되는지, 명시적 에이전트 오버라이드가 default보다 우선하는지를 실제 omp 세션으로 검증합니다.

### `LSC_FIXTURE` 응답 주입 모드

pre-craft/craft/post-craft가 사람에게 묻는 모든 질문은 `lsc_ask`/`lsc_select`/`lsc_confirm`을 거칩니다. `LSC_FIXTURE=<answers.json 경로>` 환경변수(또는 `--lsc-fixtures` 플래그)가 설정되면, 이 도구들은 대화형 UI 대신 스크립트된 응답을 반환해 파이프라인 전체를 무인(unattended)으로 실행할 수 있게 합니다.

`answers.json` v2 스키마:

```json
{
  "version": 2,
  "default": { "kind": "confirmation", "confirm": true },
  "answers": [
    { "match": "^\\[Feature Name\\]", "kind": "free-text", "freeText": "slugify 중복 구분자 제거" },
    { "match": "approach|접근", "kind": "selection", "selections": ["연속 구분자 병합"], "once": true },
    { "match": "정말 진행", "kind": "confirmation", "confirm": true }
  ]
}
```

최상위 구조는 `{ "version": 2, "answers": [<규칙>...], "default"?: <body> }`입니다. `version`은 반드시 `2`여야 하며(v1 파일은 마이그레이션 메시지와 함께 하드 에러로 거부됩니다), `default`는 선택입니다 — 지정하지 않으면 매칭되지 않은 질문은 즉시 에러로 실패합니다(무한 대기 없음). `default`에는 `free-text` kind를 쓸 수 없습니다(매칭되지 않은 모든 질문이 재질문 루프에 갇히므로).

각 규칙(rule)은 `{ "match": <정규식 문자열>, "once"?: <불리언>, ...<body> }` 형태입니다. `match`는 대소문자 무시 정규식으로 먼저 시도하고, 유효한 정규식이 아니면 대소문자 무시 부분 문자열로 폴백합니다. `once: true`면 한 번 매칭된 뒤 그 규칙은 소진됩니다. `body`는 `kind`로 태그된 4종 중 하나입니다:

| kind | 필수 필드 | 소비 도구 |
|---|---|---|
| `free-text` | `freeText` (공백 불가 문자열) | 세 도구 모두 — `lsc_ask`의 답변, 그리고 `lsc_select`/`lsc_confirm`의 자유답변 채널 |
| `selection` | `selections` (비어있지 않은 문자열 배열); 선택적 `freeText` | `lsc_select` 전용 (`freeText` 공존은 다중 선택에서만 — 단일 선택 + `freeText`는 에러) |
| `selection-index` | 0-기반 옵션 인덱스 (비음수 정수) | `lsc_select` 단일 선택 전용 (라벨이 동적일 때의 위치 기반 탈출구) |
| `confirmation` | `confirm` (불리언) | `lsc_confirm` 전용 (`true`→yes, `false`→no) |

키 화이트리스트는 엄격합니다 — 허용되지 않은 키는 파싱 시점에 경로(path)/kind/허용 키 목록을 명시하며 에러를 냅니다:

- **규칙 키**: `match`, `once`, `kind` + 해당 kind의 variant 필드만. (v1의 `response` 키가 남아 있으면 v1→v2 마이그레이션 힌트를 띄웁니다.)
- **최상위 키**: `version`, `answers`, `default`, 그리고 `_`로 시작하는 키(주석/메타데이터 관례, 예: `_note`/`_warning`)만. (`defualt` 같은 오타 키는 거부됩니다.)
- **default 키**: `kind` + 해당 kind의 variant 필드만 (`match`/`once` 불가).

- **freeText**: 정규화 후 trim 기준으로 공백만인 값은 금지됩니다. 줄바꿈은 저장 시 정규 `\n`으로 정규화됩니다 — UAX #14 필수 개행 7종(LF/VT/FF/CR/NEL U+0085/LS U+2028/PS U+2029, VT·FF 포함, CRLF는 하나로 접힘)이 모두 대상입니다.
- **다중 선택 × selection-index**: 다중 선택 질문은 `selection-index`를 쓸 수 없습니다 — 라벨을 명시한 `selection`으로 지정하세요.
- **v1→v2 마이그레이션**: v1의 단일 `response` 문자열은 v2에서 `kind` 태그 바디(`selection`/`free-text`/`confirmation`/`selection-index`)로 분리됐습니다. 문자열이던 `default`는 `{ "kind": "confirmation", "confirm": true }` 같은 바디 객체로, v1의 위치 기반 인덱스 폴백은 별도의 `selection-index` 규칙으로 옮기고, 최상위에 `"version": 2`를 반드시 추가해야 합니다(누락 시 v1로 간주되어 에러).

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
