window.SITE_CHECKLIST = [
  { title: 'The night before', icon: 'bi-moon', items: [
    'Re-read the cheat sheets for the 5 topics most likely to come up for this role',
    'Run one timed mock (Flashcards → Mock) and review every "missed" card',
    'Prepare 3 stories (a failure, a conflict, a large-scale win) in situation / action / result / what you would change form',
    'Re-read the job description and map each requirement to a concrete thing you have done',
    'Test camera, microphone, screen sharing, and a drawing tool you can use for diagrams',
    'Sleep. A rested candidate out-performs an extra hour of cramming'] },
  { title: 'The hour before', icon: 'bi-alarm', items: [
    'Water, quiet room, phone on silent, notifications off',
    'Skim your own numbers: latency, throughput, cost, team size, incident counts from your real projects',
    'Have a blank page ready for diagrams and a one-line scope template (users, scale, SLO, out of scope)'] },
  { title: 'During a system-design round', icon: 'bi-diagram-3', items: [
    'Clarify scope and ask for numbers before drawing anything; state assumptions out loud',
    'Do the back-of-the-envelope maths and say what it implies is the hard part',
    'Start with the simplest design that works, then evolve it where the numbers force you',
    'Name the failure modes, the consistency model, and what you would monitor',
    'State trade-offs and the option you rejected and why; finish with what you would do next'] },
  { title: 'During coding and deep-dive rounds', icon: 'bi-code-square', items: [
    'Restate the problem, give an example, agree edge cases, then write code',
    'Talk through complexity and what you would change at 100x scale',
    'If stuck, say what you know and what you are testing; do not go silent',
    'For production-debugging questions: reproduce, bound the blast radius, form hypotheses, then verify with data'] },
  { title: 'Behavioural and leadership', icon: 'bi-people', items: [
    'Use "I" for your decisions and "we" for team outcomes; be specific about your own contribution',
    'Give the business impact in numbers, plus the cost and the risk you accepted',
    'Show how you raise other engineers: reviews, mentoring, written decisions (ADRs)',
    'Have a real answer for "tell me about a decision you got wrong"'] },
  { title: 'Closing the interview', icon: 'bi-flag', items: [
    'Ask about team topology, on-call load, how architecture decisions are made, and what success looks like in 12 months',
    'Send a short thank-you note within 24 hours that references one specific discussion',
    'Write down every question you struggled with while it is fresh and add it to your bookmarks'] }
];
