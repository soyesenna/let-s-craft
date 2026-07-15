# ask-tool-enhancement test assets

이 디렉터리는 `ask-tool-enhancement`의 **정본(canonical) 테스트 자산**이다. 실행 진입점은 상위의 `../run_test.sh` 하나뿐이며, 매 실행마다 아래 정본을 worktree 소스 루트의 기존 관례 위치로 덮어쓴 뒤 build와 Vitest를 실행한다. 소스 루트의 sync 사본을 직접 고치지 않는다.

## Sync mapping

| 정본 (`test/assets/` 기준) | 소스 루트 sync 대상 | 역할 |
|---|---|---|
| `test/ask.test.ts` | `test/ask.test.ts` | ask/select/confirm v2 core unit 계약 |
| `test/fixtures.test.ts` | `test/fixtures.test.ts` | fixture v2 parser/matcher integration 계약 |
| `test/ask-schema.test.ts` | `test/ask-schema.test.ts` | 등록 zod schema 경계 계약 |
| `test/ask-adversarial.test.ts` | `test/ask-adversarial.test.ts` | envelope·Unicode·preflight adversarial 회귀 |
| `test/e2e-helpers.ts` | `test/e2e-helpers.ts` | E2E `tool_execution_end` content/details 관측 helper |
| `test/enforcement-rules.test.ts` | `test/enforcement-rules.test.ts` | 기존 enforcement E2E + select-gate v2 회귀 |
| `fixtures/sample-ts-cli/answers.json` | `fixtures/sample-ts-cli/answers.json` | sample CLI E2E fixture v2 |

`assets/test/*.ts`는 wildcard로 일괄 sync되므로 위 TypeScript 정본이 모두 같은 규칙을 따른다. fixture JSON은 경로를 명시해 별도로 sync한다. sync는 대상 디렉터리를 생성하고 정본으로 기존 사본을 덮어써 drift를 self-heal한다. 다른 기존 test 파일은 삭제하거나 덮어쓰지 않는다.

## Hash protection

`craft` 시작 시 `.lsc/crafts/ask-tool-enhancement/test/`의 `run_test.sh`와 모든 test asset(단 `logs/` 제외)은 SHA-256 manifest에 기록되고 tool-call enforcement로 보호된다. 그 뒤 tester나 executor가 정본을 임의 수정할 수 없으며, 변경하려면 플랫폼의 사용자 승인·diff gate가 필요하다. 따라서 이 디렉터리가 유일한 테스트 정본이고, 소스 루트의 sync 사본은 재생성 가능한 파생물이다.

## Expected state transition

1. **pre-craft / RED**: 구현 전에는 `ask.test.ts`, `fixtures.test.ts`, `ask-schema.test.ts`, `ask-adversarial.test.ts`의 v2 계약 실패가 정상이다. 그 외 기존 non-E2E suite(`preset-*`, `craft-*` 등)는 계속 green이어야 하며, 무관 실패는 expected RED로 간주하지 않는다.
2. **craft / RED → GREEN**: executor가 production source를 구현한다. 테스트 정본은 변경하지 않고 매 iteration에 `run_test.sh`를 실행한다.
3. **craft 완료 / GREEN**: build와 전체 unit/regression suite가 모두 통과해야 한다. `LSC_E2E=1` acceptance run에서는 plugin link가 현재 worktree를 가리키는지 검증한 뒤 repository의 3-file E2E suite도 통과해야 한다.

기본 unit 단계는 `LSC_E2E`를 비워 `npx vitest run` 전체를 실행한다. 따라서 E2E test 파일도 수집되지만 자체 `skipIf`로 skip되고, 나머지 모든 unit/regression 파일은 누락 없이 실행된다. 실제 E2E는 **worktree 소스 루트를 cwd로 둔 상태에서** `LSC_E2E=1 .lsc/crafts/ask-tool-enhancement/test/run_test.sh`를 호출할 때만 별도 실행한다.
