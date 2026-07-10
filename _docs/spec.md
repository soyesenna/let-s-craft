# lets-craft

- claude-code, codex 등 코딩 에이전트들의 skill, hook 등을 모아놓은 plugin
- 이 plugin 으로부터 발생되는 모든 산출물은 프로젝트 디렉터리 내부 .lsc/ 에 저장된다.
  - 만약, 전역적인 산출물이라면 각 코딩 에이전트 설정 디렉터리 내부 .lsc/ 에 저장된다.
  - eg. ~/.codex/.lsc/ , ~/.claude/.lsc/

## 모델 카테고리

- claude와 codex 는 서로 모델의 종류도, 구분하는 정도도 다르다.
- 따라서 추상화된 모델 카테고리를 사용하여 claude 와 codex 둘 다 사용할 수 있도록 한다.
- 카테고리는 low, medium, high, xhigh 로 구분한다.
  - low 는 가장 복잡도가 적은 작업에 사용한다. eg. 가벼운 코드 베이스 탐색등. 절대 추론이 필요하거나 코드 작성, 구현 작업에 사용하지 않는다.
  - medium 은 복잡도가 low 보다 복잡도가 높은 작업에 사용한다. low 와 비슷한 작업을 하지만 추론, 사소한 의사 결정 등이 필요할 때 사용한다. 절대 코드 작성, 구현 작업에 사용하지 않는다. eg. pre-craft 스킬의 trace lane 을 생성하기 위한 사전 코드베이스 탐색 작업 등
  - high 는 고난도 추론, 일반적인 코드 구현, 이미지 인식 등 복잡도가 높은 작업에 사용한다.
  - xhigh 는 초고난도 추론, 어려운 코드 구현, 구현 또는 작업 사항 적대적 검증, 코드 리뷰, 완벽히 정합해야하는 문서 작업, 이미지 인식 등 초고난도 복잡도의 작업에 사용한다. 초고난도 코드 구현을 위한 이미지 인식 작업은 xhigh 카테고리를 사용한다.

## Agent 목록
### critic
- oh-my-claudecode critic agent 와 동일
- category : xhigh

### architect
- oh-my-claudecode architect agent 와 동일
- category : xhigh

### executor
- oh-my-claudecode executor agent 와 동일
- category : 작업의 난이도와 복잡도에 따라 xhigh, high 동적 구성.

### planner
- oh-my-claudecode planner agent 와 동일
- category : xhigh

### tester
- 완성된 trace, spec, plan 을 보고 test 코드 또는 test 스크립트를 생성하는 역할.
- category : xhigh
- 기본 

## skill 목록

### pre-craft

- 이 스킬은 oh-my-claudecode 의 deep-dive 스킬이 모티브가 되었다. 이 스킬을 제작할 때는 deep-dive 스킬을 철저히 분석하고 제작한다.
- 이 skill 이 시작되면 프로젝트 디렉터리 내부 .lsc/crafts 디렉터리에 작업과 어울리는 네이밍의 디렉터리를 만든다.
  - eg. .lsc/crafts/tool-multitanent-byok/
- 이 skill 이 시작되면 git branch 를 만든다. 브랜치 이름은 자유롭게 설정하되, 브랜치 네이밍 규칙이 존재하면 철저히 따른다.
  - "--worktree" 라는 텍스트, 옵션이 프롬프트에 포함되어있으면 worktree 를 만들어서 작업한다. 이 worktree 는 프로젝트 내부 .lsc/worktrees/ 디렉터리에 생성한다.
- 이 스킬은 trace -> interview -> plan -> test 순서대로 실행한다.
- trace : 사용자 프롬프트에 대한 코드베이스 탐색. trace lane 개수 제한 없음 -> trace 문서 생성. trace 문서의 크기(길이) 제한 없음. 최대한 상세하게  적는다.
  - trace lane 생성 공식은 oh-my-claudecode deep-dive, trace skill에 따른다.
  - trace lane 을 생성하기 위한 사전 코드 베이스 탐색을 수행하여 trace lane 을 확정한다. ( oh-my-claudecode deep-dive skill 참고 )
  - 생성된 문서는 .lsc/crafts/{feature-name}/trace.md 에 저장한다.
- interview : 모호도 5% 미만까지 인터뷰 -> spec 생성
  - 모호도 계산 공식은 oh-my-claudecode의 deep-dive, deep-interview 스킬 공식에 따른다.
  - 생성된 문서는 .lsc/crafts/{feature-name}/spec.md 에 저장한다.
  - 생성된 spec 은 최대한 상세하게 작성한다. spec 문서의 크기(길이) 제한 없음.
- plan : spec 을 구현하기 위한 계획 합의 루프(ralplan)
  - oh-my-claudecode 처럼 planner, critic, architect 합의 루프를 거친다. iteration 횟수 제한은 10번.
  - 생성된 문서는 .lsc/crafts/{feature-name}/plan.md 에 저장한다.
  - 생성된 plan 은 최대한 상세하게 작성한다. plan 문서의 크기(길이) 제한 없음.
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
- pre-craft skill 로 만들어진 산출물 디렉터리 경로(.lsc/crafts/{feature-name})를 전달해주면 그 디렉터리 내부 문서들을 철저히 분석 후 체계적이고 단계적인 구현을 시작한다.
- 구현은 run_test.sh 로 실행되는 테스트가 모두 통과할 때 까지 수정, 개선을 반복한다. run_test.sh 로 실행되는 테스트들이 전부 통과하지 않았는데 구현을 멈추면 안된다.(hook 으로 강제)
- 절대 run_test.sh 과 테스트 코드를 수정하지 않는다. (hook 으로 강제)

### post-craft
- craft 단계에서 구현이 완료된 구현 내용을 철저히 적대적 검증하는 skill
- pre-craft skill 로 만들어진 산출물 디렉터리 경로(.lsc/crafts/{feature-name})와 구현 branch or worktree 에 구현된 내용을 철저히 적대적 검증한다. spec 과 정합한지, plan 대로 만들었는지 등등 철저히 적대적 리뷰어 입장에서 검증, 리뷰한다.
- 


## 규칙(RULE 로 들어갈 시스템 프롬프트)

- SubAgent 를 적극 활용한다.
- 구현 하면서 기능 단위로 커밋한다. 가급적 대규모 커밋을 만들지 말것.
- 커밋에는 what(무엇을 만들었는지), why(왜 만들었는지), evidence(구현의 증거), verify(검증은 어떻게 했는지)