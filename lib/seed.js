// Seed library: hand-authored storyboards standing in for videos that earlier
// learners already generated. Each scene may carry `deeper`, a pre-made
// "explain this part" breakdown used by the offline generator.
// Stats are synthetic (no real student data) so the ranking has something to show.

const S = (heading, narration, visual, deeper) => ({ heading, narration, visual, ...(deeper ? { deeper } : {}) });

module.exports = [
  {
    title: 'Photosynthesis: how plants make food from light',
    subject: 'Biology', grade: '9-10', style: 'Story',
    tags: ['photosynthesis', 'plants', 'chlorophyll', 'glucose', 'sunlight', 'leaf', 'chloroplast', 'carbon dioxide', 'oxygen', 'plant food'],
    summary: 'Plants capture sunlight in chloroplasts and turn water and carbon dioxide into glucose and oxygen.',
    scenes: [
      S('A leaf is a solar-powered kitchen', 'Every green leaf is a tiny kitchen. Its power source is sunlight, and its job is to cook sugar the plant can use as food.',
        { kind: 'title', emoji: '🍃', caption: 'Leaf = kitchen, Sun = stove' }),
      S('The ingredients', 'The recipe needs three things. Water pulled up from the roots, carbon dioxide breathed in from the air, and light from the sun.',
        { kind: 'icons', items: [{ e: '💧', t: 'Water (H₂O)' }, { e: '🌫️', t: 'Carbon dioxide (CO₂)' }, { e: '☀️', t: 'Sunlight' }] },
        [
          S('Water comes up from the roots', 'Roots soak up water from the soil. Thin tubes called xylem carry it all the way up the stem into the leaf.', { kind: 'flow', steps: ['Soil', 'Roots', 'Xylem', 'Leaf'] }),
          S('Carbon dioxide comes in through pores', 'The underside of a leaf has tiny pores called stomata. They open to let carbon dioxide drift in from the air.', { kind: 'icons', items: [{ e: '🌫️', t: 'CO₂ in the air' }, { e: '🕳️', t: 'Stomata open' }, { e: '🍃', t: 'Into the leaf' }] }),
          S('Light is the energy, not an ingredient you can hold', 'Sunlight is not mixed in like flour. It is the energy that powers the reaction, like heat from a stove.', { kind: 'compare', left: { h: 'Ingredients', items: ['Water', 'Carbon dioxide'] }, right: { h: 'Energy source', items: ['Sunlight'] } }),
        ]),
      S('Chlorophyll catches the light', 'Inside the leaf are chloroplasts, packed with a green pigment called chlorophyll. Chlorophyll absorbs red and blue light, and reflects green, which is why leaves look green.',
        { kind: 'icons', items: [{ e: '🟢', t: 'Chloroplast' }, { e: '🔴', t: 'Absorbs red' }, { e: '🔵', t: 'Absorbs blue' }, { e: '🟩', t: 'Reflects green' }] },
        [
          S('Light is a mix of colours', 'White sunlight is really a mix of colours, from red to violet. Different pigments grab different colours.', { kind: 'keywords', words: ['red', 'orange', 'yellow', 'green', 'blue', 'violet'] }),
          S('Chlorophyll is picky', 'Chlorophyll grabs red and blue light strongly but barely uses green. The green bounces off and reaches your eyes.', { kind: 'compare', left: { h: 'Absorbed', items: ['Red light', 'Blue light'] }, right: { h: 'Reflected', items: ['Green light'] } }),
          S('Captured light becomes chemical energy', 'The energy chlorophyll captures is stored in carrier molecules, ready to build sugar in the next step.', { kind: 'flow', steps: ['Light', 'Chlorophyll', 'Energy carriers', 'Sugar factory'] }),
        ]),
      S('The recipe', 'Put it together and you get the photosynthesis equation. Six carbon dioxide plus six water, powered by light, make one glucose and six oxygen.',
        { kind: 'equation', text: '6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂', note: 'powered by light energy' },
        [
          S('Read the left side', 'On the left are the inputs: six molecules of carbon dioxide and six of water.', { kind: 'equation', text: '6CO₂ + 6H₂O', note: 'inputs' }),
          S('Read the right side', 'On the right are the outputs: one molecule of glucose, the sugar, and six of oxygen gas.', { kind: 'equation', text: 'C₆H₁₂O₆ + 6O₂', note: 'outputs' }),
          S('Atoms are conserved', 'Count the atoms. Six carbons, twelve hydrogens and eighteen oxygens on each side. Nothing is lost, just rearranged.', { kind: 'compare', left: { h: 'Left side', items: ['6 C', '12 H', '18 O'] }, right: { h: 'Right side', items: ['6 C', '12 H', '18 O'] } }),
        ]),
      S('Why it matters to you', 'The glucose feeds the plant and, through food chains, feeds you. The oxygen is released into the air you breathe.',
        { kind: 'flow', steps: ['Sunlight', 'Plant sugar', 'Food chain', 'You'] }),
    ],
    quiz: [
      { q: 'Which gas do plants take in for photosynthesis?', options: ['Oxygen', 'Carbon dioxide', 'Nitrogen'], answer: 1 },
      { q: 'Why do leaves look green?', options: ['Chlorophyll reflects green light', 'They contain green water', 'Glucose is green'], answer: 0 },
    ],
    stats: { views: 412, completions: 338, likes: 121, dislikes: 9, quizAttempts: 290, quizCorrect: 247, explainRequests: 31 },
  },
  {
    title: 'Photosynthesis in 60 seconds (equation focus)',
    subject: 'Biology', grade: '9-10', style: 'Quick recap',
    tags: ['photosynthesis', 'equation', 'glucose', 'chloroplast', 'light reactions', 'calvin cycle'],
    summary: 'A fast walkthrough of the photosynthesis equation and its two stages.',
    scenes: [
      S('Two stages', 'Photosynthesis happens in two stages: the light reactions and the Calvin cycle.', { kind: 'compare', left: { h: 'Light reactions', items: ['Thylakoids', 'Need light', 'Make ATP + NADPH'] }, right: { h: 'Calvin cycle', items: ['Stroma', 'No light needed', 'Builds glucose'] } }),
      S('Light reactions', 'Light splits water, releasing oxygen and charging up energy carriers called ATP and NADPH.', { kind: 'flow', steps: ['Light', 'Split H₂O', 'O₂ released', 'ATP + NADPH'] }),
      S('Calvin cycle', 'The Calvin cycle spends that energy to fix carbon dioxide into glucose.', { kind: 'flow', steps: ['CO₂', 'Carbon fixation', 'G3P', 'Glucose'] }),
      S('The equation', 'Overall: six CO2 plus six H2O gives glucose plus six O2.', { kind: 'equation', text: '6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂', note: 'light energy' }),
    ],
    quiz: [
      { q: 'Where does the oxygen released in photosynthesis come from?', options: ['Carbon dioxide', 'Water', 'Glucose'], answer: 1 },
    ],
    stats: { views: 268, completions: 241, likes: 44, dislikes: 17, quizAttempts: 199, quizCorrect: 112, explainRequests: 58 },
  },
  {
    title: "Newton's three laws of motion",
    subject: 'Physics', grade: '9-10', style: 'Story',
    tags: ['newton', 'laws of motion', 'force', 'inertia', 'acceleration', 'action reaction', 'f=ma', 'mass', 'physics'],
    summary: 'Inertia, F = ma, and action-reaction, explained with a skateboard.',
    scenes: [
      S('Meet the skateboard', "We'll use one skateboard to understand all three of Newton's laws.", { kind: 'title', emoji: '🛹', caption: "Newton's laws, one skateboard" }),
      S('Law 1: Inertia', 'An object keeps doing what it is doing unless a force acts on it. A still skateboard stays still. A rolling one keeps rolling until friction slows it.',
        { kind: 'flow', steps: ['At rest', 'No force', 'Stays at rest'] },
        [
          S('Inertia means resisting change', 'Inertia is an object\'s tendency to resist changes in motion. It is not a force, it is a property.', { kind: 'title', emoji: '🧱', caption: 'Inertia resists change' }),
          S('Why things seem to stop by themselves', 'On Earth, friction and air resistance are invisible forces that slow things down. In space, a pushed object would glide forever.', { kind: 'compare', left: { h: 'On Earth', items: ['Friction', 'Air resistance', 'Board stops'] }, right: { h: 'In space', items: ['No friction', 'Keeps gliding'] } }),
          S('Seatbelts are inertia in action', 'When a car brakes, your body keeps moving forward. The seatbelt supplies the force that stops you.', { kind: 'icons', items: [{ e: '🚗', t: 'Car brakes' }, { e: '🧍', t: 'You keep moving' }, { e: '🔒', t: 'Seatbelt force' }] }),
        ]),
      S('Law 2: F = ma', 'Force equals mass times acceleration. Push an empty skateboard and it zooms. Push one carrying your friend just as hard and it barely speeds up.',
        { kind: 'equation', text: 'F = m × a', note: 'more mass → less acceleration for the same push' },
        [
          S('What each letter means', 'F is the net force in newtons. m is mass in kilograms. a is acceleration in metres per second squared.', { kind: 'icons', items: [{ e: '💪', t: 'F: force (N)' }, { e: '⚖️', t: 'm: mass (kg)' }, { e: '🚀', t: 'a: acceleration (m/s²)' }] }),
          S('Try a number', 'A 2 kilogram board pushed with 10 newtons accelerates at 5 metres per second squared. Ten divided by two is five.', { kind: 'equation', text: 'a = F ÷ m = 10 ÷ 2 = 5 m/s²', note: 'rearrange the formula' }),
          S('Double the mass', 'Put a 2 kilogram backpack on it, so 4 kilograms total. The same push now gives only 2.5. Double the mass, half the acceleration.', { kind: 'compare', left: { h: '2 kg', items: ['10 N push', 'a = 5'] }, right: { h: '4 kg', items: ['10 N push', 'a = 2.5'] } }),
        ]),
      S('Law 3: Action and reaction', 'For every action there is an equal and opposite reaction. Push off a wall on your skateboard and the wall pushes you back just as hard.',
        { kind: 'compare', left: { h: 'Action', items: ['You push the wall →'] }, right: { h: 'Reaction', items: ['← Wall pushes you'] } }),
    ],
    quiz: [
      { q: 'Same push, twice the mass. What happens to acceleration?', options: ['Doubles', 'Halves', 'Stays the same'], answer: 1 },
      { q: 'A rolling ball on a perfectly frictionless surface will…', options: ['Slow down', 'Keep rolling', 'Speed up'], answer: 1 },
    ],
    stats: { views: 530, completions: 402, likes: 160, dislikes: 14, quizAttempts: 377, quizCorrect: 301, explainRequests: 44 },
  },
  {
    title: 'Causes of the French Revolution',
    subject: 'History', grade: '9-10', style: 'Story',
    tags: ['french revolution', 'france', 'estates', 'louis xvi', 'bastille', 'enlightenment', 'debt', 'revolution', '1789', 'history'],
    summary: 'Debt, inequality and new ideas pushed France to revolution in 1789.',
    scenes: [
      S('France, 1789', 'In 1789 France was rich in palaces but broke in its treasury. Bread prices were soaring and people were hungry.', { kind: 'title', emoji: '🥖', caption: 'France, 1789: expensive bread, empty treasury' }),
      S('Three Estates', 'Society was split into three estates. Clergy and nobles were a tiny minority but paid almost no taxes. The Third Estate, everyone else, paid for nearly everything.',
        { kind: 'compare', left: { h: '1st & 2nd Estates', items: ['Clergy & nobles', '~2% of people', 'Few taxes'] }, right: { h: 'Third Estate', items: ['Peasants, workers, merchants', '~98% of people', 'Most taxes'] } },
        [
          S('Who was in each estate', 'The First Estate was the clergy. The Second was the nobility. The Third was everyone else, from poor peasants to wealthy lawyers.', { kind: 'icons', items: [{ e: '⛪', t: '1st: Clergy' }, { e: '👑', t: '2nd: Nobles' }, { e: '🧑‍🌾', t: '3rd: Everyone else' }] }),
          S('Why it felt unfair', 'Each estate got one vote, so the two privileged estates could always outvote the Third, even though it was 98 percent of the people.', { kind: 'equation', text: '2 votes vs 1 vote', note: 'despite 2% vs 98% of the population' }),
          S('The breaking point', 'In June 1789 the Third Estate declared itself the National Assembly and swore the Tennis Court Oath, refusing to leave until France had a constitution.', { kind: 'flow', steps: ['Estates-General', 'Walkout', 'National Assembly', 'Tennis Court Oath'] }),
        ]),
      S('A kingdom in debt', 'Wars, including helping the Americans win independence, left France deeply in debt. King Louis the Sixteenth tried to raise taxes, which made everything worse.',
        { kind: 'flow', steps: ['Costly wars', 'Huge debt', 'New taxes', 'Anger'] }),
      S('Dangerous new ideas', 'Enlightenment thinkers like Rousseau and Voltaire argued that power should come from the people and that all citizens deserve equal rights.',
        { kind: 'icons', items: [{ e: '📜', t: 'Rousseau: popular sovereignty' }, { e: '🖋️', t: 'Voltaire: free speech' }, { e: '⚖️', t: 'Montesquieu: separation of powers' }] }),
      S('The spark', 'On the fourteenth of July 1789, crowds stormed the Bastille prison. The revolution had begun.',
        { kind: 'timeline', events: [{ y: 'May 1789', t: 'Estates-General meets' }, { y: 'Jun 1789', t: 'Tennis Court Oath' }, { y: '14 Jul 1789', t: 'Storming of the Bastille' }] }),
    ],
    quiz: [
      { q: 'Which group paid most of the taxes?', options: ['The clergy', 'The nobility', 'The Third Estate'], answer: 2 },
      { q: 'Which event on 14 July 1789 marks the start of the revolution?', options: ['Storming of the Bastille', 'Tennis Court Oath', 'Execution of Louis XVI'], answer: 0 },
    ],
    stats: { views: 377, completions: 290, likes: 98, dislikes: 11, quizAttempts: 260, quizCorrect: 201, explainRequests: 37 },
  },
  {
    title: 'Mitosis: how one cell becomes two',
    subject: 'Biology', grade: '9-10', style: 'Story',
    tags: ['mitosis', 'cell division', 'chromosomes', 'prophase', 'metaphase', 'anaphase', 'telophase', 'cell cycle', 'pmat'],
    summary: 'The four phases of mitosis, remembered with PMAT.',
    scenes: [
      S('Why cells divide', 'You grow and heal because your cells copy themselves. Mitosis makes two identical cells from one.', { kind: 'title', emoji: '🧫', caption: '1 cell → 2 identical cells' }),
      S('Prophase', 'Chromosomes coil up and become visible, and the nuclear envelope starts to break down.', { kind: 'icons', items: [{ e: '🧬', t: 'Chromosomes condense' }, { e: '💥', t: 'Nucleus breaks down' }] }),
      S('Metaphase', 'Chromosomes line up in the middle of the cell, like students lining up in a hallway.', { kind: 'icons', items: [{ e: '📏', t: 'Line up at the middle' }, { e: '🕸️', t: 'Spindle fibres attach' }] }),
      S('Anaphase', 'Spindle fibres pull the sister chromatids apart to opposite ends of the cell.', { kind: 'compare', left: { h: '← Pole A', items: ['One copy of each'] }, right: { h: 'Pole B →', items: ['One copy of each'] } }),
      S('Telophase', 'New nuclei form around each set, and the cell pinches in two. Remember it as PMAT.', { kind: 'flow', steps: ['Prophase', 'Metaphase', 'Anaphase', 'Telophase'] }),
    ],
    quiz: [
      { q: 'In which phase do chromosomes line up in the middle?', options: ['Prophase', 'Metaphase', 'Anaphase'], answer: 1 },
    ],
    stats: { views: 301, completions: 256, likes: 87, dislikes: 6, quizAttempts: 230, quizCorrect: 199, explainRequests: 20 },
  },
  {
    title: 'The Pythagorean theorem',
    subject: 'Math', grade: '8-9', style: 'Story',
    tags: ['pythagoras', 'pythagorean theorem', 'right triangle', 'hypotenuse', 'a2+b2=c2', 'geometry', 'triangle'],
    summary: 'Why a² + b² = c² works for every right triangle, with a ladder example.',
    scenes: [
      S('A ladder problem', 'A ladder leans against a wall. The foot is 3 metres out, and it reaches 4 metres up. How long is the ladder?', { kind: 'title', emoji: '🪜', caption: '3 m out, 4 m up, how long?' }),
      S('Right triangles', 'The wall, ground and ladder make a right triangle. The longest side, opposite the right angle, is the hypotenuse.', { kind: 'icons', items: [{ e: '📐', t: 'Right angle' }, { e: '↔️', t: 'Legs a and b' }, { e: '↗️', t: 'Hypotenuse c' }] }),
      S('The theorem', 'Square the two legs and add them. That equals the square of the hypotenuse.', { kind: 'equation', text: 'a² + b² = c²', note: 'only for right triangles' }),
      S('Solve it', 'Three squared is nine, four squared is sixteen. Nine plus sixteen is twenty-five, and the square root of twenty-five is five. The ladder is 5 metres.', { kind: 'equation', text: '3² + 4² = 9 + 16 = 25 → c = 5', note: 'the ladder is 5 m' }),
    ],
    quiz: [
      { q: 'A right triangle has legs 6 and 8. What is the hypotenuse?', options: ['10', '14', '48'], answer: 0 },
    ],
    stats: { views: 455, completions: 401, likes: 140, dislikes: 8, quizAttempts: 380, quizCorrect: 333, explainRequests: 18 },
  },
  {
    title: 'Supply and demand',
    subject: 'Economics', grade: '11-12', style: 'Story',
    tags: ['supply', 'demand', 'price', 'market', 'equilibrium', 'economics', 'scarcity'],
    summary: 'How prices are set where buyers and sellers meet, using concert tickets.',
    scenes: [
      S('Concert tickets', 'Your favourite artist announces one show. Thousands want tickets but there are only so many seats.', { kind: 'title', emoji: '🎟️', caption: 'Many fans, few seats' }),
      S('Demand', 'Demand is how much people want to buy at each price. When price goes up, people buy less.', { kind: 'flow', steps: ['Price ↑', 'Fewer buyers', 'Quantity demanded ↓'] }),
      S('Supply', 'Supply is how much sellers offer at each price. Higher prices make sellers want to sell more.', { kind: 'flow', steps: ['Price ↑', 'More sellers', 'Quantity supplied ↑'] }),
      S('Equilibrium', 'The market price settles where the amount people want to buy equals the amount sellers offer. That is equilibrium.', { kind: 'compare', left: { h: 'Price too low', items: ['Shortage', 'Long queues'] }, right: { h: 'Price too high', items: ['Surplus', 'Empty seats'] } }),
    ],
    quiz: [
      { q: 'If price rises, quantity demanded usually…', options: ['Rises', 'Falls', 'Stays the same'], answer: 1 },
    ],
    stats: { views: 190, completions: 150, likes: 51, dislikes: 5, quizAttempts: 140, quizCorrect: 112, explainRequests: 15 },
  },
  {
    title: 'The water cycle',
    subject: 'Earth Science', grade: '8-9', style: 'Story',
    tags: ['water cycle', 'evaporation', 'condensation', 'precipitation', 'collection', 'rain', 'clouds'],
    summary: 'Evaporation, condensation, precipitation and collection.',
    scenes: [
      S('One drop, many journeys', 'The water you drink today might once have been in a dinosaur, a glacier or a cloud.', { kind: 'title', emoji: '💧', caption: 'Water is recycled forever' }),
      S('Evaporation', 'The sun heats oceans and lakes, turning liquid water into invisible water vapour.', { kind: 'flow', steps: ['Sun heats water', 'Liquid', 'Vapour rises'] }),
      S('Condensation', 'High up it is cold, so vapour cools and condenses into tiny droplets that form clouds.', { kind: 'icons', items: [{ e: '🌡️', t: 'Cools down' }, { e: '☁️', t: 'Clouds form' }] }),
      S('Precipitation and collection', 'Droplets merge until they are heavy enough to fall as rain or snow, collecting in rivers and oceans to start again.', { kind: 'flow', steps: ['Evaporation', 'Condensation', 'Precipitation', 'Collection'] }),
    ],
    quiz: [
      { q: 'What forms clouds?', options: ['Evaporation', 'Condensation', 'Collection'], answer: 1 },
    ],
    stats: { views: 240, completions: 210, likes: 66, dislikes: 4, quizAttempts: 190, quizCorrect: 171, explainRequests: 9 },
  },
  {
    title: 'Ionic vs covalent bonds',
    subject: 'Chemistry', grade: '9-10', style: 'Story',
    tags: ['chemical bonding', 'ionic bond', 'covalent bond', 'electrons', 'atoms', 'chemistry', 'salt', 'molecule'],
    summary: 'Atoms either give away electrons (ionic) or share them (covalent).',
    scenes: [
      S('Atoms want full shells', 'Atoms are most stable with a full outer shell of electrons. Bonds are how they get there.', { kind: 'title', emoji: '⚛️', caption: 'Goal: a full outer shell' }),
      S('Ionic: give and take', 'In table salt, sodium gives one electron to chlorine. Now one is positive, one negative, and opposites attract.', { kind: 'flow', steps: ['Na gives e⁻', 'Na⁺ and Cl⁻', 'Attract', 'NaCl'] }),
      S('Covalent: sharing', 'In water, oxygen shares electrons with two hydrogens. Nobody gives anything away, they share.', { kind: 'icons', items: [{ e: '🔴', t: 'Oxygen' }, { e: '🤝', t: 'Shared electrons' }, { e: '⚪', t: '2 × Hydrogen' }] }),
      S('Quick test', 'Metal plus non-metal usually means ionic. Two non-metals usually means covalent.', { kind: 'compare', left: { h: 'Ionic', items: ['Metal + non-metal', 'Transfer', 'e.g. NaCl'] }, right: { h: 'Covalent', items: ['Non-metal + non-metal', 'Sharing', 'e.g. H₂O'] } }),
    ],
    quiz: [
      { q: 'Water (H₂O) is held together by…', options: ['Ionic bonds', 'Covalent bonds', 'Magnetism'], answer: 1 },
    ],
    stats: { views: 210, completions: 160, likes: 48, dislikes: 9, quizAttempts: 150, quizCorrect: 104, explainRequests: 29 },
  },
  {
    title: 'The Industrial Revolution',
    subject: 'History', grade: '9-10', style: 'Story',
    tags: ['industrial revolution', 'steam engine', 'factories', 'britain', 'industrialization', 'urbanization', 'history'],
    summary: 'How steam power and factories reshaped work and cities from the 1760s.',
    scenes: [
      S('Before machines', 'In 1750 most people farmed and made goods by hand at home.', { kind: 'title', emoji: '🧶', caption: 'Hand-made, home-made' }),
      S('Steam changes everything', "James Watt's improved steam engine could power machines anywhere, not just next to rivers.", { kind: 'flow', steps: ['Coal', 'Steam engine', 'Machines', 'Factories'] }),
      S('Cities explode', 'People moved to cities for factory jobs. Cities grew fast, often crowded and polluted.', { kind: 'timeline', events: [{ y: '1760s', t: 'Spinning jenny' }, { y: '1776', t: "Watt's steam engine" }, { y: '1830', t: 'First intercity railway' }] }),
      S('Winners and losers', 'Goods got cheaper and new wealth was created, but workers, including children, faced long hours and dangerous conditions.', { kind: 'compare', left: { h: 'Gains', items: ['Cheaper goods', 'Railways', 'New jobs'] }, right: { h: 'Costs', items: ['Child labour', 'Pollution', 'Slums'] } }),
    ],
    quiz: [
      { q: 'Which invention let factories be built away from rivers?', options: ['Steam engine', 'Telegraph', 'Printing press'], answer: 0 },
    ],
    stats: { views: 160, completions: 120, likes: 35, dislikes: 6, quizAttempts: 110, quizCorrect: 80, explainRequests: 12 },
  },
];
