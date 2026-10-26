## [Closed] #10 스킵 시 마지막 라인 컷씬/자동진행 미동작

- 문서 ID: ISSUE-010 (Dialogue Skip / Cutscene Flow)
- 심각도: Critical
- 발생 환경: Windows 11 (1920×1080), 프롤로그 대화 시퀀스(001_Prologue1) 및 컷씬 전환 구간
- 재현 경로:
  1. 001_Prologue1 등 컷씬(BLACK), AUTO_DELAYED, FADE_OUT 태그가 포함된 대화를 시작한다.
  2. 대화가 마지막 라인에 도달하기 전에 Skip 버튼을 클릭하거나, 검은 화면 페이드(FadeToBlack) 도중 Skip을 클릭한다.
  3. 마지막 대사 출력 이후의 화면 전환 및 클릭 입력 반응 여부를 관찰한다.
- 실제 결과:
  - 마지막 라인에 설정된 BLACK 컷씬 전환, AUTO_DELAYED 자동 진행, FADE_OUT 연출이 실행되지 않고 대화창이 정지한다.
  - FadeToBlack() 도중 Skip 클릭 시 StopAllCoroutines()로 코루틴이 중단되면서 isCutsceneFadingToBlack = true 상태가 잔존해 이후 대화 클릭 입력이 영구 차단된다.
- 원인 및 수정 요약:
  - SkipButtonClick()이 일반 타이핑 완료 경로(TypeSentence)를 우회하고 코루틴 중단 후 상태 플래그를 복구하지 않아 발생.
  - isSkippingToLast 플래그 도입, 스킵 시 isCutsceneFadingToBlack / isCoverTransitioning 명시적 false 초기화, BLACK 즉시 반영 및 AfterLineFullyShownRoutine() 공통 후처리 루틴 호출로 수정 완료.

## [Closed] #11 MemoryPuzzleStates 직렬화 오류로 인한 Save/Load 실패

- 문서 ID: ISSUE-011 (Save / Load Serialization)
- 심각도: Critical
- 발생 환경: Windows 11, 이어하기(Continue) 및 수동 세이브 슬롯 로드 시점
- 재현 경로:
  1. 게임 플레이 중 회상 퍼즐 선택 상태(MemoryPuzzleStates)가 갱신된 시점에서 세이브를 수행한다.
  2. 타이틀 화면 또는 메뉴에서 해당 세이브 파일을 이어하기(Load)로 불러온다.
- 실제 결과:
  - SaveData.ToJson() 및 SaveManager.ApplySavedGameData() 과정에서 NullReferenceException이 발생하며 로드에 실패한다.
  - 저장된 JSON 파일을 확인하면 MemoryPuzzleStates(Dictionary<int, bool>)가 JSON 객체가 아닌 "System.Collections.Generic.Dictionary`2[System.Int32,System.Boolean]" 문자열(ToString())로 기록되어 있다.
- 원인 및 수정 요약:
  - 커스텀 직렬화 로직에서 Dictionary<int, bool> 타입 분기가 누락되어 기본 ToString()으로 직렬화된 것이 원인.
  - "dict:int-bool" 명시적 타입 태그 및 JSON 문자열 직렬화/역직렬화 로직을 추가하고, 구버전·손상 세이브 파일 로드 시 빈 Dictionary로 안전하게 복구(Fallback)되도록 방어 코드 적용 완료.

## [Closed] #12 회상 선택 재적용 시 ResponsibilityScore가 중복 증가하는 문제

- 문서 ID: ISSUE-012 (Responsibility Score / Memory Puzzle State)
- 심각도: Major
- 발생 환경: Windows 11, 회상 퍼즐 재진입 및 Save/Load 반복 구간
- 재현 경로:
  1. 회상 퍼즐에서 긍정 선택지를 골라 ResponsibilityScore가 증가한 상태를 만든다.
  2. 세이브/로드 또는 회상 이벤트 재진입을 통해 동일 회상 선택이 다시 평가되는 경로를 반복 수행한다.
  3. 현재 ResponsibilityScore 수치와 선택지 잠금 조건, 엔딩 분기 판정 상태를 확인한다.
- 실제 결과:
  - 회상 선택 시 점수를 단순 증감(++)으로 누적하여, 동일 회상이 재적용될 때 전체 완료한 회상 퍼즐 개수보다 ResponsibilityScore가 비정상적으로 높게 누적된다.
- 원인 및 수정 요약:
  - ResponsibilityScore를 MemoryPuzzleStates와 별도 변수로 두고 단순 증감(++) 처리한 것이 원인.
  - Result_MemoryChoiceUpdated 호출 시 MemoryPuzzleStates(Dictionary<int, bool>)의 true 개수를 기준으로 점수를 다시 계산해 대입하도록 수정하고, ResponsibilityManager.ChangeResponsibilityGauge()에 반영.

## [Closed] #13 PuzzleMemoryManager 이름 치환 시점 오류

- 문서 ID: ISSUE-013 (Puzzle Memory UI / Placeholder Processing)
- 심각도: Major
- 발생 환경: Windows 11, 프롤로그 이름 설정 이후 퍼즐 가방(회상) UI 진입 구간
- 재현 경로:
  1. 프롤로그에서 플레이어 이름과 고양이 이름을 기본값이 아닌 사용자 지정 이름으로 입력한다.
  2. 스테이지 진입 후 퍼즐 가방 UI를 열어 해금된 회상 텍스트의 이름 표시 상태를 확인한다.
- 실제 결과:
  - 플레이어가 프롤로그에서 설정한 실제 이름이 아니라 초기화 시점의 임시 기본 이름이 회상 텍스트에 그대로 출력된다.
- 원인 및 수정 요약:
  - PuzzleMemoryManager.Awake()에서 CSV 파싱 직후 ProcessPlaceholders()를 1회만 수행해 이름 입력 이전의 임시값이 choiceTextDictionary에 고정된 것이 원인.
  - 원문 보관용 memoryDictionary와 UI 출력용 choiceTextDictionary를 분리하고, 퍼즐 가방 UI를 열 때마다 UpdateHomePuzzleState()에서 최신 GameManager 이름 변수로 동적 치환하도록 수정 완료.

## [Closed] #14 씬 전환 후 튜토리얼 UnityEvent의 싱글톤 매니저 참조 유실

- 문서 ID: ISSUE-014 (Tutorial Event / ServiceAction Command Pattern)
- 심각도: Major
- 발생 환경: Windows 11, 씬 전환 이후 진행되는 튜토리얼 노드 이벤트 실행 구간
- 재현 경로:
  1. 타이틀 씬에서 생성되어 DontDestroyOnLoad로 유지되는 싱글톤 매니저(SoundPlayer, UIManager, GameManager)가 존재하는 상태에서 스테이지 씬으로 전환한다.
  2. 인스펙터 UnityEvent로 매니저 메서드를 연결해 둔 튜토리얼 노드를 실행한다.
- 실제 결과:
  - 다른 씬에 존재하는 싱글톤 오브젝트를 프리팹/씬 UnityEvent 인스펙터에 직접 바인딩할 수 없거나, 씬 전환 후 참조가 유실되어 튜토리얼 연출 및 사운드/UI 호출이 누락된다.
- 원인 및 수정 요약:
  - 씬에 배치된 UnityEvent가 다른 씬에서 넘어온 DontDestroyOnLoad 싱글톤을 직접 직렬화하지 못해 발생.
  - ScriptableObject 기반 ServiceCallAction(SerializeReference CallPayload)으로 호출 방식을 바꾸고, 실행 시점에 Instance ?? FindObjectOfType<T>(true)로 매니저를 찾아 호출하도록 수정.

## [In Progress] #15 Stage3 추격 마지막 NPC 발걸음 미재생

- 문서 ID: ISSUE-015 (Stage3 Chase / NPC Footstep Audio)
- 심각도: Major
- 발생 환경: Windows 11, Stage3 추격 시퀀스 마지막 NPC 자동 이동(NpcAutoMover) 연출 구간
- 재현 경로:
  1. Stage3 추격전을 진행하여 마지막 NPC가 등장해 이동하는 연출 구간에 진입한다.
  2. NpcAutoMover에 의해 NPC가 이동할 때 발걸음 효과음(walkSound) 출력 여부를 확인한다.
- 실제 결과:
  - NpcAutoMover에서 walkInterval 주기로 AudioSource.PlayOneShot(walkSound)이 호출되지만 실제 인게임에서는 발걸음 소리가 전혀 들리지 않는다.
- 원인 및 수정 요약:
  - 동일 오브젝트의 ObjectSfxController(거리/환경음 페이드 및 정지 제어)와 NpcAutoMover가 같은 AudioSource 컴포넌트를 공유하여, 환경음 페이드 아웃 시 볼륨이 0이 되거나 Stop()이 호출되면서 PlayOneShot 출력이 함께 차단됨.
  - NPC 발걸음 전용 AudioSource를 분리 배치하여 환경음 제어 경로와 단발성 발걸음 SFX 경로가 간섭하지 않도록 수정 반영 후 Stage3 후반부 빌드 재검증 진행 중.

## [Open] #16 BGM 전환 중 오디오 메모리 부족 발생

- 문서 ID: ISSUE-016 (SoundPlayer / BGM Resource Management)
- 심각도: Critical
- 발생 환경: Windows 11, 다중 씬 반복 전환 및 BGM 크로스페이드(ChangeDualBGM) 집중 구간
- 재현 경로:
  1. 씬 전환과 대화/이벤트 연출이 반복되는 구간을 연속 플레이하며 SoundPlayer.ChangeDualBGM()을 여러 차례 트리거한다.
  2. BGM 페이드 인/아웃 도중 다음 씬으로 빠르게 전환하거나 회상 연출에 반복 진입한다.
- 실제 결과:
  - FadeInCoroutine() 내부의 AudioSource.Play() 호출 시점에 FMODSample 오디오 메모리 할당 실패(Out of Memory) 오류가 발생하며 BGM 재생이 중단된다.
- 원인 및 수정 요약:
  - 크로스페이드용 AudioSource 및 이전 페이드 코루틴, 장시간 BGM AudioClip 참조, UI 루프/타이핑 사운드가 씬 전환 시점에 즉시 해제되지 않고 누적된 것이 원인.
  - Dual BGM AudioSource 2개 고정 재사용, StopAllBGMCoroutines() 및 SceneManager.activeSceneChanged 기반 CleanupBeforeSceneLoad() 도입, 정지 시 clip = null 해제, 대용량 BGM 클립의 Load Type = Streaming / Vorbis / Preload Audio Data 해제 적용 후 장기 플레이 회귀 테스트 대기 중.