# lets-craft

`lets-craft`는 [omp](https://www.npmjs.com/package/@oh-my-pi/pi-coding-agent)(`@oh-my-pi/pi-coding-agent`) 코딩 에이전트 CLI 위에서 동작하는 구조화 개발 파이프라인 플러그인입니다. "아이디어를 던지면 알아서 구현되는" 방식 대신, **조사 → 합의된 사양/계획/테스트 확보 → 테스트가 통과할 때까지 강제되는 구현 루프 → 적대적 감사 후 병합**이라는 명시적 단계를 거치도록 설계되었습니다.

이 플러그인은 `pre-craft` / `craft` / `post-craft`라는 3단계 철학으로 구성됩니다.

1. **pre-craft** — 아무 코드도 작성하지 않고, `trace(조사) → interview(요구사항 인터뷰) → plan(계획 합의)` 순서로 진행해 `.lsc/crafts/{feature}/` 아래에 `trace.md`, `spec.md`, `plan.md`를 만듭니다. 이 산출물이 다음 단계의 유일한 입력입니다.
2. **craft** — pre-craft 산출물(또는 post-craft가 남긴 감사 결과)을 입력받아 **단발로** 구현합니다. plan.md의 작업이 서로소 단위로 나뉘면 병렬 `lsc-executor` 레인을, 아니면 단일 `lsc-executor`를 스폰하고 스스로 통합·정리한 뒤 종료합니다 — 반복 루프도 보호된 테스트 트리도 없습니다. 테스트는 이제 post-craft가 구현 완료 후에 저작합니다.
3. **post-craft** — craft가 만든 구현물에 대한 회귀 테스트와 결정적 체크 진입점(`check/run_check.sh`)을 먼저 저작한 뒤, `trace.md`/`spec.md`/`plan.md`에 대해 적대적으로 재검증하고, 4단계 판정(`APPROVE` / `APPROVE-WITH-COMMENT` / `APPROVE-WITH-CHANGE` / `REJECT`)을 `.lsc/crafts/{feature}/audit/audit-N.md`에 기록합니다. 판정에 따라 craft를 다시 호출하거나(수정 필요), 사용자의 명시적 승인 후 병합·워크트리 정리(land)까지 진행합니다.

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

- **pre-craft**: `trace → interview → plan` 3단계를 고정 순서로 실행해 `.lsc/crafts/{feature}/`에 `trace.md`/`spec.md`/`plan.md`를 생성합니다. 구현 코드는 절대 작성하지 않고, 마지막에 `craft` 실행을 안내하는 핸드오프 메시지로 끝납니다.
- **craft**: pre-craft 산출물(또는 post-craft의 `audit/audit-N.md`)을 입력으로, plan.md가 서로소 작업으로 분해되면 병렬 executor 레인을, 아니면 단일 `lsc-executor`를 스폰하는 **단발 실행**입니다. 루프를 소유하지 않으며, 병렬 레인은 `cherry-pick`으로 직접 통합합니다 — `git merge`는 이 스킬에서 절대 호출되지 않고, 병합은 post-craft의 `lsc_land` 전용입니다.
- **post-craft**: 회귀 테스트와 `check/run_check.sh`를 저작한 뒤, 완성된 구현을 `trace.md`/`spec.md`/`plan.md`에 대해 적대적으로 검증하고 4단계 판정을 `.lsc/crafts/{feature}/audit/audit-N.md`에 기록합니다. 판정에 따라 craft 재호출을 제안하거나(사용자 승인 시) 병합·워크트리 정리를 진행합니다.

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
4. **Stage 3 plan**: `lsc-planner`가 작성한 `plan.md`를 `lsc-architect`와 `lsc-critic`이 **두 리뷰 레인**으로 함께 스폰되어 동일한 `sha256` 앵커 기준으로 검토하는 합의 루프(최대 10회 반복)를 거쳐 ADR을 포함해 확정합니다. critic은 기본적으로 **plan-only 레인**으로 architect 리뷰 없이 독립 판정하며, **리뷰 join gate**가 두 레인의 보고·앵커·반복 회차 일치를 확인한 뒤에만 합의 판정이 내려집니다. architect가 `AWC-EQUIVALENT`를 반환할 때만 **순차 fallback**으로 critic이 Change Spec을 한 번 더 감사합니다. 완료 시 커밋합니다.
5. 이렇게 각 단계(research/trace/spec/plan) 완료마다 feature 브랜치에 개별 커밋이 쌓입니다(총 4개 이상). 마지막으로 `craft` 실행을 안내하는 핸드오프 질문으로 끝나며, 사용자가 승인하면 같은 세션에서 곧바로 `craft` 스킬로 이어서 진행합니다(자동 체이닝 — `LSC_FIXTURE` 픽스처 모드에서는 이중 실행 방지를 위해 비활성화되고, 거부 시 `craft`를 수동으로 다시 호출하라는 안내만 표시됩니다).

### 2. craft 실행

`"craft"` / `/craft`라고 말하거나 `.lsc/crafts/{feature}/`(혹은 `audit/audit-N.md`) 경로를 전달하면 트리거됩니다. pre-craft가 만든 워크트리를 자동으로 감지해 그 안에서 구현을 진행합니다. `lsc_craft_init` 한 번 호출 후, plan.md의 Detailed TODOs가 서로소 작업 단위로 나뉘면 `[Parallel Lanes]`로 확인받아 `lsc_scaffold`가 만든 형제 worktree에서 병렬 `lsc-executor` 레인을, 그렇지 않으면 단일 `lsc-executor`를 스폰합니다 — 반복 루프가 아니라 단발 실행입니다. 병렬 레인은 `forkPoint` 기준 `cherry-pick`으로 feature 브랜치에 통합한 뒤 레인 worktree·브랜치를 정리합니다(`git merge`는 이 단계에서 절대 호출되지 않습니다). 빌드/타입체크 실패가 보고되면 `[Craft Incomplete]`로 1회 재실행 여부를 묻습니다. 완료하면 사용자 승인 시 같은 세션에서 곧바로 `post-craft`로 이어집니다(자동 체이닝, pre-craft와 동일 규칙).

### 3. post-craft 실행

`"post-craft"` / `/post-craft`라고 말하면 트리거됩니다. `lsc-test-engineer`를 스폰해 구현 diff를 커버하는 회귀 테스트와 `check/run_check.sh`를 저작시키고, `lsc_run_check`로 결정적 체크를 실행한 뒤, `lsc-explore`(코드 매핑)와 `lsc-critic`(적대적 리뷰)를 병렬 스폰해 spec/plan 컴플라이언스 매트릭스를 직접 확인하고 4단계 판정을 워크트리 내부의 `audit/audit-N.md`에 기록합니다. 결정적 체크가 실패하면(또는 재저작 상한을 넘겨 실행조차 못 하면) verdict는 `REJECT`/`APPROVE-WITH-CHANGE`만 가능한 하드 게이트입니다.

- `REJECT` / `APPROVE-WITH-CHANGE` → craft를 감사 문서 경로로 재호출하도록 제안(사용자 승인 시 자동 체이닝).
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
                        ├── .craft-state.json   # 재시작 durable craft 상태 (gitignored)
                        ├── check/              # post-craft가 구현 완료 후 저작
                        │   ├── run_check.sh    # 단일 진입점 (추적됨)
                        │   └── logs/
                        │       └── check-N.log # lsc_run_check 실행 로그 (gitignored)
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

craft는 더 이상 플랫폼 레벨의 강제 메커니즘을 갖지 않습니다 — 해시 보호·테스트 트리 수정 차단·중단 방지 백스톱은 구현-전 테스트 고정 설계와 함께 제거되었습니다(테스트는 이제 post-craft가 구현 완료 후에 저작합니다, 아래 참고). 대신 아래는 `skills/craft/SKILL.md` 자체가 명시하는 스킬-프로즈 계약입니다 — 강제하는 별도의 TypeScript 훅 없이, 오케스트레이팅 세션이 직접 지킵니다.

### 1. 단발 실행 — 루프가 아니다

craft는 plan.md의 Detailed TODOs를 읽고, 서로소 작업 단위 2개 이상이 있을 때만 사용자에게 `[Parallel Lanes]`로 확인받아 병렬 `lsc-executor` 레인을 스폰합니다. 그 외에는 단일 `lsc-executor`를 정확히 한 번 스폰합니다. 빌드/타입체크 실패가 보고되면 `[Craft Incomplete]`로 딱 한 번만 재실행 여부를 사용자에게 묻고, 그 결과와 무관하게 두 번째 재실행은 없습니다 — 반복은 자동이 아니라 사용자 판단 1회로 상한이 걸려 있습니다.

### 2. 병렬 레인 통합 — cherry-pick, 절대 merge 아님

병렬 레인은 감사 사이클 번호가 포함된 슬러그(`{feature}-c{C}-lane-{K}`)로 만든 형제 worktree에서 실행됩니다. craft 시작 시점에 기록한 `forkPoint`(그 시점의 `HEAD`)를 기준으로 각 레인이 실제로 그 지점에서 분기했는지 `git merge-base --is-ancestor`로 가드한 뒤 `git cherry-pick`으로 feature 브랜치에 순차 통합합니다. **craft는 어떤 경우에도 `git merge`를 실행하지 않습니다** — 병합은 post-craft의 `lsc_land`가 사용자의 명시적 승인을 거쳐 단독으로 수행합니다. 통합 성공 후 레인 worktree와 브랜치(`branch -D`)를 정리해, 다음 감사 사이클이 낡은 레인 브랜치를 재사용하지 않도록 합니다.

### 3. 중단 경로

사용자가 명시적으로 중단을 요청하면 `lsc_craft_abort`가 활성 craft를 중단 상태로 기록합니다. 이전 설계에 있던 해시 위반·테스트 실행 불가·무진전(no-progress) 자동 에스컬레이션 게이트는 모두 제거되었습니다 — 남은 유일한 중단 경로는 사용자의 명시적 지시뿐입니다.

## 테스트/검증

### `npm test` — 유닛 테스트

```bash
npm test   # vitest run
```

`test/**/*.test.ts`를 대상으로 하며, `node_modules/`, `dist/`, 벤더 트리, `fixtures/**`는 명시적으로 제외됩니다(`vitest.config.ts`). E2E 테스트 파일(`e2e-full-cycle.test.ts`, `e2e-preset-default.test.ts`)은 `LSC_E2E` 환경변수가 없으면 `describe.skipIf`로 전부 스킵되므로, `npm test`는 실제 omp 프로세스나 실제 토큰을 전혀 건드리지 않습니다.

### `npm run e2e` — 실제 omp 통합 E2E

```bash
npm run e2e
# 내부적으로: npm run build && LSC_E2E=1 vitest run \
#   test/e2e-full-cycle.test.ts test/e2e-preset-default.test.ts \
#   --no-file-parallelism --testTimeout=10200000 --hookTimeout=120000
```

**경고 — 실제 토큰을 소비합니다.** 이 2개 파일은 실제 `omp` 바이너리를 헤드리스(`-p --mode=json`)로 자식 프로세스로 구동하며, 실제로 인증된 provider에 대해 실제 API 호출을 발생시킵니다. `--no-file-parallelism`으로 파일 간 동시 실행을 막고, 테스트당 최대 170분(`testTimeout=10200000`ms), 훅당 최대 2분(`hookTimeout=120000`ms)의 타임아웃이 걸려 있습니다. 각 테스트 파일 내부에도 단계별(pre-craft/craft/post-craft) 독립적인 kill 타임아웃이 별도로 걸려 있어, 멈추거나 반복하는 모델이 하네시 전체를 무한정 붙잡지 못하도록 되어 있습니다.

- `test/e2e-full-cycle.test.ts`: 항상-워크트리 토폴로지로 pre-craft → craft(단발 실행) → post-craft(테스트 저작+감사) → land 전체를 픽스처 샘플에 대해 구동합니다. 워크트리 내부에 `trace.md → spec.md → plan.md`가 순서대로 생성되고 `test/` 트리는 만들어지지 않는지, base 브랜치가 그 동안 무오염임(산출물 커밋 0건)을 확인하고, pre-craft 단계별 커밋이 3개 이상 쌓였는지, post-craft가 저작한 회귀 테스트가 diff에 존재하고 `check/run_check.sh`와 통과하는 `check/logs/check-N.log`가 있는지, `audit-0.md`에 판정 라인이 기록되는지, 마지막으로 승인 가능한 판정에서 워크트리가 base 브랜치로 병합·제거되고 산출물·구현·체크·감사가 base에 나타나는지까지 단계별로 확인합니다. 트레이스 추론의 질이나 spec 모호도 계산의 정확성 같은 의미론적 판단은 검증하지 않고, 산출물 존재/작성 순서/커밋 위상/문자 그대로의 감사 판정 라인만 확인합니다.
- `test/e2e-preset-default.test.ts`: 구조형 프리셋의 세션 default 모델이 세션 시작 시 실제로 적용되는지, 명시적 에이전트 오버라이드가 default보다 우선하는지를 실제 omp 세션으로 검증합니다.

### `LSC_FIXTURE` 응답 주입 모드

pre-craft/craft/post-craft가 사람에게 묻는 모든 질문은 `lsc_ask`/`lsc_select`/`lsc_confirm`을 거칩니다. `LSC_FIXTURE=<answers.json 경로>` 환경변수(또는 `--lsc-fixtures` 플래그)가 설정되면, 이 도구들은 대화형 UI 대신 스크립트된 응답을 반환해 파이프라인 전체를 무인(unattended)으로 실행할 수 있게 합니다.

`answers.json`는 fixture 스키마 **v2**입니다(v1 하위 호환 없음 — 구포맷은 parse 시 명확한 마이그레이션 에러). 각 규칙과 `default`는 응답의 **의미(kind)를 태깅한 body**를 가지며, 이 태깅 덕분에 "승인과 반대 의사가 한 body에 공존"하는 모순 조합이 parse 단계에서 원천 차단됩니다.

```json
{
  "version": 2,
  "_note": "선택적 메타데이터 — '_' 접두 키는 top-level에서만 허용",
  "answers": [
    { "match": "^\\[Feature Name\\]", "kind": "free-text", "freeText": "..." },
    { "match": "^\\[Spec Change\\]", "kind": "selection", "selections": ["Accept — apply to spec.md/plan.md"] },
    { "match": "pick the nth", "kind": "selection-index", "optionIndex": 0, "once": true },
    { "match": "proceed\\??$", "kind": "confirmation", "confirm": true }
  ],
  "default": { "kind": "confirmation", "confirm": true }
}
```

**공통 규칙 필드**: `match`(질문에 대해 먼저 대소문자 무시 정규식, 실패 시 대소문자 무시 부분 문자열 폴백), `once`(true면 첫 매칭 후 규칙 소진). 규칙은 선언 순서대로 first-hit로 평가됩니다.

**kind별 body** — 허용 키는 이 표가 전부이며, 그 외 키는 파서가 path·kind·허용 키 목록을 나열하며 거부합니다:

| kind | 필수 필드 | 소비 도구 | 의미 |
|---|---|---|---|
| `free-text` | `freeText`(string) | `lsc_ask`·`lsc_select`·`lsc_confirm` 모두 | 자유 답변(select/confirm에서는 자유답변 채널) |
| `selection` | `selections`(비어있지 않은 string 배열); `freeText`(선택, multi 전용) | `lsc_select` 전용 | 라벨 선택(단일=정확히 1개, multi=여러 개) |
| `selection-index` | `optionIndex`(0-기반 음이 아닌 정수) | `lsc_select` 단일 전용 | 위치로 선택(동적 라벨 탈출구) |
| `confirmation` | `confirm`(boolean) | `lsc_confirm` 전용 | `true`=yes, `false`=no |

- **소비 도구 매트릭스**: 도구가 자기 kind가 아닌 body를 받으면 침묵 오답 대신 명확한 에러입니다 — `lsc_select`가 `confirmation`을, `lsc_confirm`이 `selection`을 받으면 오류입니다. `free-text`만 세 도구 공용입니다(인터뷰 질문이 런타임에 select/ask 중 무엇으로 발화되든 흡수). **multi select에서는 `selection-index`를 쓸 수 없습니다** — 동적 라벨 multi는 위치 지정을 표현할 수 없으므로 라벨을 명시하는 `selection`만 가능합니다.
- **freeText 값 규칙**: canonical 정규화(CRLF와 UAX #14 필수 개행 7종 — LF/VT/FF/CR/NEL(U+0085)/LS(U+2028)/PS(U+2029) — 을 `\n`으로 접기, CRLF는 하나로) 후 `trim()`한 결과가 비어 있으면(공백·개행만) 파서가 거부합니다. 저장 시에도 line-break는 canonical `\n`으로 정규화됩니다.
- **혼합 응답**: `selection`에 `freeText`를 병기하면(multi 전용) content는 **선택당 `User selected: <라벨>` 행(옵션 배열 순서) → 그 뒤 `User provided free answer:` 블록** 순으로 직렬화됩니다.
- **default**: 미매칭 질문의 폴백 body이며 `kind`+variant 필드만 허용합니다(`match`/`once` 불가). 생략하면 미매칭 질문이 무한 대기 대신 즉시 에러입니다. **`kind: "free-text"` default는 거부됩니다** — 파괴적 게이트를 포함한 모든 미매칭 질문을 자유답변 재발문 루프에 빠뜨리기 때문이며, 대신 `once: true`를 붙인 명시 규칙을 쓰세요.
- **top-level 키**: `version`(반드시 2)·`answers`·`default` + `_` 접두 메타데이터 키만 허용됩니다. 그 외(예: `defualt` 오타)는 침묵 무시 대신 거부되어 fallback이 조용히 소실되는 것을 막습니다.
- **v1 → v2 마이그레이션**: v1의 `"response"` 필드는 kind 태깅 body로 대체되었습니다 — 자유 텍스트 `response`→`{"kind":"free-text","freeText":...}`, select 라벨→`{"kind":"selection","selections":[...]}` 또는 `{"kind":"selection-index","optionIndex":n}`, yes/no→`{"kind":"confirmation","confirm":true|false}`. 파일 최상위에 `"version": 2`를 반드시 추가하세요(구포맷을 감지하면 파서가 이 매핑을 안내합니다).
- **게이트 규칙 규약**: 게이트 태그(`^\[…\]`)를 겨냥한 규칙에는 `selection` 또는 `confirmation`을 쓰세요. 게이트에서 `free-text`는 승인으로 해석되지 않고(자유답변=지침, 같은 게이트 재발문 유발) 파괴적 액션을 열지 않습니다.

번들된 샘플 픽스처는 `fixtures/sample-ts-cli/`입니다. 의존성 없는 `node --test` 기반의 최소 TypeScript CLI 프로젝트로, `slugify()`에 의도적인 버그(연속된 구분자를 하나로 합치지 못함)가 남아 있어 craft 루프가 실제로 반복 수정할 거리가 있습니다. `answers.json`(인터뷰 응답 스크립트), `recorded-research.md`(픽스처 모드에서 외부 웹 리서치 대신 읽어들이는 사전 기록 리서치), `run_test.sh`(`node --test`를 실행하고 결과를 요약하는 단일 진입점)를 포함합니다.

## dogfooding 절차

`lets-craft`는 임의의 git 저장소를 대상으로 동작하도록 설계되어 있으므로, 이 저장소 자신에도 동일하게 적용할 수 있습니다. v1 완성 이후 이어지는 기능 개발은, 다른 프로젝트에 `lets-craft`를 적용할 때와 동일한 절차를 이 저장소 자체에 대해 수행하는 것으로 진행합니다.

1. 이 저장소에서 `omp plugin link .`로 플러그인이 로드된 상태를 유지합니다(설치 절차와 동일).
2. 다음 기능/개선 아이디어를 `"pre-craft"`로 시작해, `.lsc/crafts/{feature}/`에 `trace.md → spec.md → plan.md`를 생성합니다. 이때 조사·계획 대상은 `lets-craft` 자기 자신의 `src/`, `agents/`, `skills/`, `rules/`입니다.
3. `"craft"`로 단발 구현을 진행합니다 — plan.md가 서로소 작업으로 분해되면 병렬 executor 레인을, 아니면 단일 executor를 스폰합니다. 더 이상 해시 불변성·중단 방지 백스톱 같은 강제 규칙은 적용되지 않습니다(테스트는 다음 단계인 post-craft가 구현 완료 후에 저작·실행합니다).
4. `"post-craft"`로 적대적 감사를 거쳐 판정을 기록하고, 승인 시 병합합니다.

이 저장소에는 위 절차를 거쳐 생성된 `.lsc/crafts/` 산출물이 아직 커밋되어 있지 않습니다(v1 자체는 이 파이프라인이 완성되기 전에 별도로 구현되었습니다) — 다음 기능부터 이 절차를 실제로 적용하는 것이 dogfooding의 첫걸음입니다.

## 라이선스

`package.json`은 `"license": "MIT"`를 선언하고 있습니다. 이 저장소에는 별도의 `LICENSE` 파일이 아직 포함되어 있지 않습니다.
