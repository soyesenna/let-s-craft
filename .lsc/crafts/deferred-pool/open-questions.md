# Open Questions — deferred-pool

## deferred-pool plan (초안) - 2026-07-19

전부 계획이 잠정 채택안을 명시한 **리뷰 플래그**였고, iteration 1 리뷰(architect blocking-redesign / critic REVISE)에서 전부 판정·종결됨.

- [x] lsc_land 브랜치 규칙 — **잠정안 거부됨**: "feature 브랜치가 아니기만 하면 진행"은 승인 target 미결박의 unsafe default. 종결: 무 checkout 유지 + LandOperation(target 브랜치/OID·mode) 결박 + consume 직전 재관찰 일치(plan ADR D2).
- [x] E 헬퍼 both-exist 우선순위 — **잠정안 거부됨**: 단일 우선순위는 open-release 중재(보안)와 audit-root(artifact) 정책 중 하나를 반드시 깨뜨림(기존 회귀 test/craft-state.test.ts:481-533 충돌). 종결: decode/후보 seam만 공유, 정책 2종 named 보존(plan ADR D5).
- [x] removeWorktree 내부 이중 배선 — **조건부 채택 확정**: 호출점 배선만 유지하되 "executor 재량" 조항 삭제 — validated 삭제는 land.ts 단일 경로(plan Step 2).

## deferred-pool plan (iteration 2) - 2026-07-19

iteration 2 개정 시점의 신규 잠정 결정 2건은 iteration 2 리뷰(architect Change Spec 5·10항 + critic 확증)로 **전부 판정·종결**. 구현 차단 미해결 질문 없음.

- [x] lsc_claims decision write-back 형식 — **잠정안 채택 확정(Change Spec 10항)**: claims.json 내 per-claim 현재 `decision:{status,reasons,evaluatedAt}` 필드(도구 단독 소유 — "이력" 아님, history는 git에 위임, `previousDecisions`는 기존 per-claim 현재 status에서 구성). 별도 decisions.json 기각 유지 — 단일 atomic rename이 2파일 동기화 창을 제거. 추가 종결: root는 `worktreePath(ctx.cwd, feature)` 고정, 입력 `{feature_dir}` kebab-case slug만, registered worktree+realpath containment+symlink/traversal 거부, 전-claims validate 후 단 1회 writeFileAtomicSync(1개라도 invalid면 byte 0 변경).
- [x] prepared-operation 슬롯 수명 — **TTL 없이 normative lifecycle로 종결(Change Spec 5항)**: 새 prepare의 same-tag replacement / successful issuance 후 clear / tagged no·free·cancel 후 clear / Phase R failure 후 clear / setActiveCraft·load·abort·clearActiveCraft·session_switch·session_branch·session_shutdown에서 clear / 프로세스 재시작 시 소멸(=fail-closed). invalidation은 `prepareId` conditional — confirm await 중 더 최신 prepare를 지우지 않는다. scope every-call 재관찰+exact question 결박 하에서 시간 만료는 중복 방어라 미도입.
