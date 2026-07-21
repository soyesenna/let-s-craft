# Wave 1 — Saturation wave (2026-07-20)

## Roster

| Worker | Agent | Role | Status |
|---|---|---|---|
| TracerCodePath | lsc-tracer | Lane 1 code-path (src/ask.ts seams) | completed 4m46s |
| TracerFixtureContracts | lsc-tracer | Lane 2 fixture/SSOT contracts | completed 2m53s |
| TracerHostCapability | lsc-tracer | Lane 3 premise audit (host SDK) | completed 5m23s |
| TracerBtwPriorArt | lsc-tracer | Lane 4 /btw architecture portability | completed 4m30s |
| TracerUxValue | lsc-tracer | Lane 5 UX/value design | completed 6m52s |
| RExploreSdk | lsc-explore | omp extension SDK surface inventory (16.4.0 vs 16.5.2) | completed 20m14s |
| RExploreTui | lsc-explore | host TUI rendering internals (select/editor/askDialog/custom) | completed 21m18s |
| RExplorePi | lsc-explore | pi ancestor repo (extension UI + completion precedents) | completed 11m22s |
| RLibOmpDocs | lsc-librarian | omp docs/changelog/npm release archaeology | completed 12m49s |
| RLibTuiPriorArt | lsc-librarian | select-with-explain UX prior art (web) | completed 10m49s |
| RLibSampling | lsc-librarian | "tool asks model" protocol prior art (MCP sampling 등) | completed 7m18s |

(레인 트레이서 5종은 코드베이스 레인 소속이지만 EXPAND 규약 없이 트레이서 보고 형식으로 보고 — 리서치 리드는 아래에 통합.)

## EXPAND tails (unconfirmed leads → wave 2 targets)

1. [RExploreSdk/RLibOmpDocs/RExploreTui] askDialog: local "Chat about this" row가 bcee73e58(v16.4.5)에서 제거됨 — `git show`로 제거된 로컬 chat wiring(#finishChat/onChat) 복원 조사; onLeft/onRight dialogOptions의 호스트 처리 시맨틱; askDialog 문서화 zero(안정성 리스크). → **W2AskDialogArch**
2. [RExploreSdk/RExplorePi] BYO-completion 상세: completeSimple/streamSimple + modelRegistry.getApiKey/resolver의 OAuth rotation·abort·에러 표면·vitest 경계. → **W2PiAiDeep**
3. [RLibOmpDocs] npm 버전 경로: askDialog 최초 수록 published 버전 확정; 17.x loadMode:"discoverable" 기본값 변화 리스크(lsc_* 도구가 xd:// 마운트로 변함); pi-ai/pi-tui 락스텝 여부. → **W2NpmVersions**
4. [RLibTuiPriorArt] edlsh/pi-ask-user — omp extension으로 split-pane 상세 preview를 구현한 최근접 선행 사례; 구현 기법 추출. → **W2PiAskUser**
5. [RLibOmpDocs] issue #6085 sidebranch.ts (SessionManager.forkFrom + orphan repair) — ReadonlySessionManager Pick에 forkFrom 부재 여부 확인으로 축소(→ W2AskDialogArch (4)).
6. [RLibSampling] context-scoping fork(full-history vs question-only)는 리서치 리드가 아니라 **설계 결정** — open-questions로 이관.
7. [RExplorePi] pi examples question.ts/questionnaire.ts/qna.ts — 이미 충분히 특성화됨, 추가 조사 불요.
