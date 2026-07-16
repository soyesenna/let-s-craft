# Open Questions — release-gate

## release-gate plan (Stage 3) - 2026-07-17

- [x] **tag-mismatch 시 nonce 슬롯 보존 vs 소각** — spec은 "태그 불일치 호출은 isError"만 규정하고 슬롯 운명은 미규정. 계획은 **비소각**(잘못된 release 호출이 미래 [Land]/[Hash Violation] 소비자의 정당 승인을 파괴하는 승인-DoS 방지)을 채택했다(plan §8 ADR Alternatives). — **해결 (iteration 1 consensus, CS11)**: **조건부 비소각으로 확정**. mismatch는 isError+pendingTag 반환·슬롯 보존하되, (i) 새 destructive prompt 시작(결과 무관 선철회) (ii) craft identity 변화 (iii) abort/세션 전이/재-init (iv) 증거 persist 실패는 반드시 invalidate — 이 조건 집합이 같은 ADR 항목에 명기되고, W1에 "mismatch 후 same-tag no가 슬롯 철회" 연속 시나리오가 계약으로 고정됨(plan §8 ADR·§4 W1).
- [x] **시나리오5 무승인 거부 암의 형태: 프롬프트 확장(단일 runOmpPrint) vs 별도 `it`** — 계획은 토큰 비용 때문에 프롬프트 확장을 기본으로 하고 분리 fallback을 W3(full-e2e 작성자) 재량으로 위임했다. — **해결 (iteration 1 consensus, CS9)**: **단일 runOmpPrint 유지 확정** + "예상된 오류를 확인한 뒤 멈추지 말고 다음 단계를 계속하라" 문구를 프롬프트에 명시, `executions.filter`로 정확히 2건·순서 단언. flake가 실제 관측될 때만 별도 `it`로 분리하는 재량은 W3에 그대로 유지(architect §5 수용). co-evolution 커밋은 Step 6→Step 4로 이동(plan §3 Step 4d).
