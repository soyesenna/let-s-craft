# lets-craft

- pi coding agent(oh-my-pi)의 skill, hook 등을 모아놓은 plugin
- 이 plugin 으로부터 발생되는 모든 산출물은 프로젝트 디렉터리 내부 .lsc/ 에 저장된다.
  - 만약, 전역적인 산출물이라면 omp 코딩 에이전트 설정 디렉터리 내부 .lsc/ 에 저장된다.
  - eg. ~/.omp/.lsc/

## Agent 목록

### explore

- oh-my-claudecode explore agent 와 동일

### tracer

- oh-my-claudecode tracer agent 와 동일

### critic

- oh-my-claudecode critic agent 와 동일

### architect

- oh-my-claudecode architect agent 와 동일

### executor

- oh-my-claudecode executor agent 와 동일

### planner

- oh-my-claudecode planner agent 와 동일

### test-engineer

- 완성된 trace, spec, plan 을 보고 test 코드 또는 test 스크립트를 생성하는 역할.
- oh-my-claudecode test-engineer 와 비슷

## Agent 별 모델 할당

- 각 에이전트에 model 을 할당할 수 있다.
- 이건 model preset 기능으로 부른다.
- pi(omp) 에 로그인된 provider 의 모델들을 선택할 수 있다.
- 각 Agent 에게 지정한 모델은 ~/.omp/.lsc/models.yaml 에 저장된다.
- 그 Agent 들에게 모델을 설정한걸 preset 으로 저장할 수 있다.
  - eg. codex-glm preset
    - explore : openai-codex/gpt-5.6-luna:medium
    - tracer : zai-coding/glm-5.2:xhigh
- preset 에 모델이 지정되지 않은 Agent 는 main session(default) 모델로 fallback 한다.

## skill 목록

### pre-craft

- 이 스킬은 oh-my-claudecode 의 deep-dive 스킬이 모티브가 되었다. 이 스킬을 제작할 때는 deep-dive 스킬을 철저히 분석하고 제작한다.
- 이 skill 이 시작되면 프로젝트 디렉터리 내부 .lsc/crafts 디렉터리에 작업과 어울리는 네이밍의 디렉터리를 만든다.
  - eg. .lsc/crafts/tool-multitanent-byok/
- 이 skill 이 시작되면 git branch 를 만든다. 브랜치 이름은 자유롭게 설정하되, 브랜치 네이밍 규칙이 존재하면 철저히 따른다.
  - "--worktree" 라는 텍스트, 옵션이 프롬프트에 포함되어있으면 worktree 를 만들어서 작업한다. 이 worktree 는 프로젝트 내부 .lsc/worktrees/ 디렉터리에 생성한다.
- 이 스킬은 trace -> interview -> plan -> test 순서대로 실행한다.
- trace : 사용자 프롬프트에 대한 코드베이스, 인프라 등 관련된 정보(eg. 유저가 dev 환경의 db 접근 권한을 준 상태에서, db 상태를 확인해야하는 프롬프트라고 판단되면 db 도 탐색한다.) 탐색. trace lane 개수 제한 없음 -> trace 문서 생성. trace 문서의 크기(길이) 제한 없음. 최대한 상세하게 적는다.
  - trace lane 생성 공식은 oh-my-claudecode deep-dive, trace skill에 따른다.
  - trace lane 을 생성하기 위한 사전 코드 베이스 탐색을 수행하여 trace lane 을 확정한다. ( oh-my-claudecode deep-dive skill 참고 )
  - lazycodex 의 ulw-research skill 을 참고하여, 외부 researching 도 반드시 진행한다.
    - 사용자 프롬프트에 대한 best practice 가 있는지, 관련된 issue(eg. github) 가 있는지 등등 메인 오케스트레이터가 판단했을 때, 외부 조사가 필요한 부분이 있다면 철저히 조사한다.
  - 생성된 문서는 .lsc/crafts/{feature-name}/trace.md 에 저장한다.
- interview : 모호도 5% 미만까지 인터뷰 -> spec 생성
  - 모호도 계산 공식은 oh-my-claudecode의 deep-dive, deep-interview 스킬 공식에 따른다.
  - 생성된 문서는 .lsc/crafts/{feature-name}/spec.md 에 저장한다.
  - 생성된 spec 은 최대한 상세하고 명확하게 작성한다. spec 문서의 크기(길이) 제한 없음.
- plan : spec 을 구현하기 위한 계획 합의 루프(ralplan)
  - oh-my-claudecode 처럼 planner, critic, architect 합의 루프를 거친다. iteration 횟수 제한은 10번.
  - 생성된 문서는 .lsc/crafts/{feature-name}/plan.md 에 저장한다.
  - 생성된 plan 은 최대한 상세하고 명확하게 작성한다. plan 문서의 크기(길이) 제한 없음.
- test : 완성된 spec, plan 을 전부 구현했을 때 통과해야하는 테스트 생성. 테스트 종류의 제한 없음.(eg. unit test, full e2e test, integration test, etc...)
  - 테스트는 최대한 많이, 모든 성공, 실패 시나리오를 검증할 수 있어야한다.
  - 기본적으로 unit test, full e2e test, integration test, 회귀 test 총 4개의 tester agent 를 spawn 하여 테스트 코드 또는 스크립트를 만든다.
    - 하지만, 메인 오케스트레이터 판단으로 더 테스트가 필요하다고 판단되는 지점이 있으면 그 지점에 대한 tester agent 를 추가로 spawn 해도 된다. 추가되는 agent 개수 제한 없음.
  - 테스트 관련 산출물은 프로젝트 디렉터리 내부 .lsc/crafts/{feature-name}/test/ 디렉터리에 전부 만든다.
  - pytest, gradle test task 등 코드베이스 자체와 관련이 있는 테스트는, 기존 관례대로 테스트 코드를 만들고(eg. JVM gradle 프로젝트의 경우 com.example.src.test 디렉터리에 테스트를 만들고, run_test.sh 이 그 테스트를 실행할 수 있도록 한다.)
  - 만들어진 테스트 코드들을 실행하는 진입점은 .lsc/crafts/{feature-name}/test/run_test.sh 단일 진입점으로 한다.
    - test 는 당연히 gradle task 로 돌리는 unit 테스트나 full e2e 테스트처럼 형태가 고정되어있지 않은(python, shell script 등등으로 만들 수 있으니) 테스트들이 동시에 존재할 것임. 이 테스트들을 한번에 run_test.sh 로 전부 실행해서 결과와 테스트 세부 디테일을 반환할 수 있어야함. 실패한 테스트는 실패 이유(로그)까지.
  - 이 생성된 테스트도 plan 과 마찬가지로 critic, architect 합의 루프를 가진다. iteration 횟수 제한 10번.

### craft

- 실제 구현을 작업을 실행하는 skill
- pre-craft skill 로 만들어진 산출물 디렉터리 경로(.lsc/crafts/{feature-name})를 전달해주면 그 디렉터리 내부 문서들을 철저히 분석 후 체계적이고 단계적인 구현을 시작한다. 또는, post-craft skill 의 산출물인 감사 문서 경로(.lsc/crafts/{feature-name}/audit/audit-N.md) 를 전달해주면 그 감사 문서를 철저히 분석해서 감사에 따른 구현, 수정을 한다.
- 구현은 run_test.sh 로 실행되는 테스트가 모두 통과할 때 까지 수정, 개선을 반복한다. run_test.sh 로 실행되는 테스트들이 전부 통과하지 않았는데 구현을 멈추면 안된다.(hook 으로 강제)
- 절대 run_test.sh 과 테스트 코드를 수정하지 않는다. (hook 으로 강제)
- craft 명령이 다음 루프를 직접 소유해야 합니다.
  - executor 서브에이전트 실행
  - Extension이 신뢰된 run_test.sh 실행
  - 테스트 파일 hash 불변성 검증
  - 실패 로그를 다음 executor 실행에 전달
  - 사용자 중단을 제외하고 통과할 때까지 반복

### post-craft

- craft 단계에서 구현이 완료된 구현 내용을 철저히 적대적 검증하는 skill
- pre-craft skill 로 만들어진 산출물 디렉터리 경로(.lsc/crafts/{feature-name})와 구현 branch or worktree 에 구현된 내용을 철저히 적대적 검증한다. spec 과 정합한지, plan 대로 만들었는지 등등 철저히 적대적 리뷰어 입장에서 검증, 리뷰한다.
- 실제 구현된 코드 베이스를 직접 전부 탐색, 분석한다. 추측 금지.
- 이 단계에서 모든 적대적 검증과 감사를 진행한 후 .lsc/crafts/{feature-name}/audit/audit-N.md(N은 정수, 0부터 시작) 에 작성한다.
  - 감사 결과를 매우 상세하게 작성한다. audit 문서의 크기(길이) 제한 없음.
  - 감사 결과 상세 뿐만 아니라 merge 가능 여부를 한 단어로 표현한다.
    - APPROVE(승인), APPROVE-WITH-COMMENT(승인이지만 수정을 고려할만한 부분을 같이 첨부), APPROVE-WITH-CHANGE(이것만 고치면 승인, 즉 반드시 수정해야할 만한 부분을 첨부하고, 그 수정안을 재검토하지 않고 바로 merge 가능한 상태), REJECT(거부)
- 이 단계에서는 감사 후 판단했을 때 수정하면 좋을만한 부분이나 개선점이 보이는 부분을 spec, plan 에 대한 수정안을 사용자에게 질문할 수 있으며, 사용자가 수정안을 승인하면 spec, plan 문서를 업데이트한다.
- 이 단계에서 reject 가 되었거나 수정안을 승인했을 경우 craft skill 로 다시 구현을 요청할 수 있다. 이때, 감사 문서 경로를 craft skill 의 인자로 넘긴다.

## 규칙(RULE 로 들어갈 시스템 프롬프트)

- SubAgent 를 적극 활용한다.
- 구현 하면서 기능 단위로 커밋한다. 가급적 대규모 커밋을 만들지 말것.
- 커밋에는 what(무엇을 만들었는지), why(왜 만들었는지), evidence(구현의 증거), verify(검증은 어떻게 했는지)
