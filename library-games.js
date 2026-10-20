const nytSource =
    'https://thenewyorktimeshelpcenter.helpjuice.com/360011158491-New-York-Times-Games/360052272251-New-York-Times-Games-Subscription';
const goatSource = 'https://clevergoat.com/';

// These are editorial entries. Suggestions never change the published library.
export const LIBRARY_GAMES = [
  {
    id: 'wordle',
    name: 'Wordle',
    url: 'https://www.nytimes.com/games/wordle',
    category: 'Words',
    description: 'Find the five-letter word in six guesses.',
    source: nytSource
  },
  {
    id: 'strands',
    name: 'Strands',
    url: 'https://www.nytimes.com/games/strands',
    category: 'Words',
    description: 'Find themed words and the spangram in a letter grid.',
    source: nytSource
  },
  {
    id: 'connections',
    name: 'Connections',
    url: 'https://www.nytimes.com/games/connections',
    category: 'Words',
    description: 'Sort sixteen words into four connected groups.',
    source: nytSource
  },
  {
    id: 'waffle',
    name: 'Waffle',
    url: 'https://wafflegame.net/daily',
    category: 'Words',
    description: 'Swap letters to solve six intersecting words.',
    source: 'https://wafflegame.net/daily'
  },
  {
    id: 'categories',
    name: 'Categories',
    url: 'https://categories.clevergoat.com/',
    category: 'Words',
    description: 'Spot the four groups hidden among sixteen words.',
    source: goatSource
  },
  {
    id: 'wordlinx',
    name: 'WordLinx',
    url: 'https://sacsgames.com/wordlinx/',
    category: 'Words',
    description: 'Use a hint and shared-letter clues to solve four linked words.',
    source: 'https://sacsgames.com/'
  },
  {
    id: 'onewordsearch',
    name: 'OneWordSearch',
    url: 'https://puzzlist.com/onewordsearch/',
    category: 'Words',
    description: 'A daily word search with just one word to find.',
    source: 'https://puzzlist.com/onewordsearch/'
  },
  {
    id: 'wordly',
    name: 'Wordly',
    url: 'https://wordly.org/uk',
    category: 'Words',
    description:
      'Guess a word using British English spelling. Choose one puzzle for your daily routine.',
    cadence: 'Unlimited • play once daily',
    source: 'https://wordly.org/uk'
  },
  {
    id: 'wordgrid',
    name: 'Word Grid',
    url: 'https://wordgrid.clevergoat.com/',
    category: 'Words',
    description:
      'Fill a three-by-three grid with words that fit the row and column clues.',
    source: goatSource
  },
  {
    id: 'crossherd',
    name: 'Crossherd',
    url: 'https://crossherd.clevergoat.com/',
    category: 'Words',
    description: 'A compact five-by-five mini crossword.',
    source: goatSource
  },
  {
    id: 'contexto',
    name: 'Contexto',
    url: 'https://www.contexto.me/en/',
    category: 'Words',
    description:
      'Find the secret word using clues about how close your guesses are in meaning.',
    source: 'https://www.contexto.me/en/'
  },
  {
    id: 'nerdle',
    name: 'Nerdle',
    url: 'https://nerdlegame.com/',
    category: 'Numbers',
    description: 'Work out the hidden calculation in six guesses.',
    source: 'https://faqs.nerdlegame.com/games/classic-nerdle.html'
  },
  {
    id: 'nyt-sudoku',
    name: 'Sudoku',
    url: 'https://www.nytimes.com/puzzles/sudoku',
    category: 'Numbers',
    description:
      'Fill the grid with digits, with fresh easy, medium and hard puzzles each day.',
    source: nytSource
  },
  {
    id: 'pips',
    name: 'Pips',
    url: 'https://www.nytimes.com/games/pips',
    category: 'Logic',
    description: 'Place dominoes so each region meets its rules.',
    source: nytSource
  },
  {
    id: 'starbattle',
    name: 'Star Battle',
    url: 'https://starbattle.clevergoat.com/',
    category: 'Logic',
    description: 'Place stars so each row, column and region has exactly one.',
    source: goatSource
  },
  {
    id: 'worldle',
    name: 'Worldle',
    url: 'https://worldle.teuteuf.fr/',
    category: 'Geography',
    description:
      'Identify a country from its outline, with distance and direction clues.',
    source: 'https://worldle.teuteuf.fr/'
  },
  {
    id: 'globle',
    name: 'Globle',
    url: 'https://globle-game.com/',
    category: 'Geography',
    description:
      'Find the mystery country using warmer and colder clues on a globe.',
    source: 'https://globle-game.com/?authuser=0'
  },
  {
    id: 'the-or-no-the',
    name: 'The or No The',
    url: 'https://www.theornothe.com/',
    category: 'Quiz',
    description: 'Decide whether the phrase starts with "The" or not.',
    source: 'https://www.theornothe.com/'
  },
  {
    id: 'chain',
    name: 'Chain',
    url: 'https://playthechaingame.com/',
    category: 'Words',
    description:
      'Guess the words where each new word starts with the last letter of the previous one.',
    source: 'https://playthechaingame.com/'
  },
  {
    id: 'tightrope',
    name: 'Tightrope',
    url: 'https://www.britannica.com/quiz/tightrope',
    category: 'Quiz',
    description: `Answer nine questions to walk the tightrope. Three wrong and you're gone.`,
    source: 'https://www.britannica.com/quiz/tightrope'
  }
].map(game => ({
  cadence: 'New puzzle daily',
  checkedOn: '2026-10-20',
  ...game
}));
