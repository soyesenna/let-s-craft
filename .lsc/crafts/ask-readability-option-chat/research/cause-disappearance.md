# Cause Disappearance — 배제된 대안 설명과 그 근거

추적했다가 배제된 대안들. (정본 원장은 claims.json; 이 파일은 서사 기록.)

1. **"호스트가 이미 explain-chat을 제공한다 (askDialog chat)"** — 배제. ExtensionAskDialogChatResult{kind:"chat"} 타입은 공개 계약에 있으나, 로컬 인터랙티브 AskDialog의 "Chat about this" 행은 bcee73e58(v16.4.5)에서 제거되어 collab/guest 원격 경로에만 잔존. 게다가 그 chat도 main-loop 핸드오프(tools on, persisted)로 ephemeral 시맨틱이 아님. [RLibOmpDocs, RExploreTui, TracerBtwPriorArt]

2. **"pi에 btw.ts 번들 예제가 있다"** — 배제. `/tmp/extensions/btw.ts`는 interactive-mode-status.test.ts:724-735의 합성 테스트 데이터일 뿐, pi repo에 btw 구현/예제 파일은 존재하지 않음. [RExplorePi]

3. **"MCP sampling을 기반으로 설계한다"** — 배제(기반으로서). 2026-07-28 RC에서 deprecated(SEP-2577), 주요 클라이언트 채택 zero. shape 참조로만 유지. [RLibSampling]

4. **"호스트가 description을 제대로 못 그려서 가독성이 낮다" (P1a)** — 반증. HookSelectorComponent는 muted/indent/wrap/ellipsis로 정상 렌더. 병목은 compact-mode 물리 제약(O23)과 lets-craft 자신의 텍스트 부피/작성. [TracerHostCapability]

5. **"sendMessage/sendUserMessage로 사이드챗을 돌린다"** — 배제. 둘 다 MAIN 에이전트 루프로 라우팅(tools on, persisted)되어 파이프라인 턴을 하이재킹함. ephemeral 사이드챗이 아님. [TracerHostCapability, RExplorePi]

6. **"createAgentSession으로 /btw를 재현한다"** — 강등(배제는 아님). 공개 export지만 독립 풀세션 스폰 — 라이브 턴 컨텍스트/캐시 공유 없음, 무겁고 저하된 대안. BYO completeSimple이 더 가벼운 동일 축. [TracerBtwPriorArt, RExploreSdk]

7. **"ctx.ui.select 위에 explain 키를 얹는다"** — 잠정 배제(wave 2 검증 중). HookSelector가 모든 키를 소유; 유일 후보는 onLeft/onRight dialogOptions 콜백인데 하이라이트 옵션 전달 여부 미확인 → W2AskDialogArch가 판정. [TracerHostCapability, TracerCodePath]

8. **"helpText 푸터로 옵션 설명을 해결한다"** — 배제(기능 대체로서). 전역 단일 문자열이라 per-option 설명 운반 불가; 보조적 가독성 힌트로만 유효. [TracerCodePath]
