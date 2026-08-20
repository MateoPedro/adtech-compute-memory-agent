/**
 * seed-movies.ts - the movie recommendation demo dataset.
 *
 * Creates and seeds two indices:
 *
 *   movie-catalog   - long-term knowledge: ~60 titles with genre, director,
 *                     actors, year, and an original one-line blurb indexed
 *                     as semantic_text (embedded server-side).
 *
 *   watch-history   - episodic memory for user "demo", backdated relative
 *                     to *today*, with a PLANTED TASTE SHIFT:
 *                       • ~6 to ~2 months ago: rom-coms & comedies, rated high
 *                       • last ~3 weeks: hard pivot to sci-fi & thrillers
 *                     Plus recent watches that must be EXCLUDED from recs
 *                     (e.g. Arrival, watched days ago).
 *
 * The shift is what makes decay tuning visible on stage:
 *   TASTE_DECAY_DAYS=180 → taste profile says "rom-com person" (stale you)
 *   TASTE_DECAY_DAYS=21  → taste profile says "sci-fi kick" (current you)
 *
 * Run: npx tsx src/seed-movies.ts
 */
import { Client } from "@elastic/elasticsearch";
import "dotenv/config";

const es = new Client({
  node: process.env.ELASTICSEARCH_URL!,
  auth: { apiKey: process.env.ELASTICSEARCH_API_KEY! },
});

const CATALOG = "movie-catalog";
const HISTORY = "watch-history";
const INFERENCE_ID = process.env.INFERENCE_ID || undefined;
const semanticField = INFERENCE_ID
  ? { type: "semantic_text" as const, inference_id: INFERENCE_ID }
  : { type: "semantic_text" as const };

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

// [title, year, genre, director, actors, blurb]
type Movie = [string, number, string, string, string[], string];

const movies: Movie[] = [
  // Sci-Fi
  ["Arrival", 2016, "Sci-Fi", "Denis Villeneuve", ["Amy Adams", "Jeremy Renner"], "A linguist races to decode an alien language before nations panic."],
  ["Blade Runner 2049", 2017, "Sci-Fi", "Denis Villeneuve", ["Ryan Gosling", "Harrison Ford"], "A replicant detective unearths a secret that could upend society."],
  ["Dune: Part Two", 2024, "Sci-Fi", "Denis Villeneuve", ["Timothée Chalamet", "Zendaya"], "A desert war escalates as prophecy and politics collide."],
  ["Interstellar", 2014, "Sci-Fi", "Christopher Nolan", ["Matthew McConaughey", "Anne Hathaway"], "Explorers cross a wormhole to find humanity a new home."],
  ["Ex Machina", 2014, "Sci-Fi", "Alex Garland", ["Alicia Vikander", "Oscar Isaac"], "A coder is invited to test whether a robot truly thinks."],
  ["The Martian", 2015, "Sci-Fi", "Ridley Scott", ["Matt Damon", "Jessica Chastain"], "A stranded astronaut sciences his way through survival on Mars."],
  ["Annihilation", 2018, "Sci-Fi", "Alex Garland", ["Natalie Portman", "Tessa Thompson"], "Scientists enter a shimmering zone where biology rewrites itself."],
  ["Everything Everywhere All at Once", 2022, "Sci-Fi", "Daniels", ["Michelle Yeoh", "Ke Huy Quan"], "A laundromat owner hops universes to save her family and herself."],
  ["Edge of Tomorrow", 2014, "Sci-Fi", "Doug Liman", ["Tom Cruise", "Emily Blunt"], "A soldier relives the same alien battle until he learns to win."],
  ["District 9", 2009, "Sci-Fi", "Neill Blomkamp", ["Sharlto Copley", "Jason Cope"], "A bureaucrat's exposure to alien tech makes him the hunted."],
  ["Her", 2013, "Sci-Fi", "Spike Jonze", ["Joaquin Phoenix", "Scarlett Johansson"], "A lonely writer falls for an operating system that keeps growing."],
  ["Gravity", 2013, "Sci-Fi", "Alfonso Cuarón", ["Sandra Bullock", "George Clooney"], "Two astronauts fight to survive after debris shreds their shuttle."],
  // Thriller
  ["Sicario", 2015, "Thriller", "Denis Villeneuve", ["Emily Blunt", "Benicio del Toro"], "An idealistic agent is pulled into the cartel war's gray zone."],
  ["Prisoners", 2013, "Thriller", "Denis Villeneuve", ["Hugh Jackman", "Jake Gyllenhaal"], "A father crosses every line when his daughter disappears."],
  ["Gone Girl", 2014, "Thriller", "David Fincher", ["Ben Affleck", "Rosamund Pike"], "A marriage becomes a media trial when a wife vanishes."],
  ["Se7en", 1995, "Thriller", "David Fincher", ["Brad Pitt", "Morgan Freeman"], "Two detectives chase a killer staging the seven deadly sins."],
  ["No Country for Old Men", 2007, "Thriller", "Coen Brothers", ["Javier Bardem", "Josh Brolin"], "A found bag of money brings an unstoppable killer to Texas."],
  ["Oppenheimer", 2023, "Thriller", "Christopher Nolan", ["Cillian Murphy", "Emily Blunt"], "The bomb's architect reckons with what he built."],
  ["Tenet", 2020, "Thriller", "Christopher Nolan", ["John David Washington", "Robert Pattinson"], "An operative wields time inversion to stop a coming war."],
  ["Nightcrawler", 2014, "Thriller", "Dan Gilroy", ["Jake Gyllenhaal", "Rene Russo"], "A crime-scene freelancer discovers the camera rewards escalation."],
  ["Parasite", 2019, "Thriller", "Bong Joon-ho", ["Song Kang-ho", "Cho Yeo-jeong"], "A poor family infiltrates a rich household, floor by floor."],
  ["The Girl with the Dragon Tattoo", 2011, "Thriller", "David Fincher", ["Daniel Craig", "Rooney Mara"], "A journalist and a hacker reopen a decades-old disappearance."],
  // Rom-Com
  ["Crazy Rich Asians", 2018, "Rom-Com", "Jon M. Chu", ["Constance Wu", "Henry Golding"], "Meeting the boyfriend's family turns out to mean Singapore royalty."],
  ["Notting Hill", 1999, "Rom-Com", "Roger Michell", ["Julia Roberts", "Hugh Grant"], "A bookshop owner's quiet life collides with a movie star's."],
  ["When Harry Met Sally", 1989, "Rom-Com", "Rob Reiner", ["Billy Crystal", "Meg Ryan"], "Two friends spend a decade debating whether friendship survives love."],
  ["10 Things I Hate About You", 1999, "Rom-Com", "Gil Junger", ["Heath Ledger", "Julia Stiles"], "A paid-for courtship of the school's prickliest senior turns real."],
  ["The Big Sick", 2017, "Rom-Com", "Michael Showalter", ["Kumail Nanjiani", "Zoe Kazan"], "A comedian bonds with his ex's parents at her hospital bedside."],
  ["Palm Springs", 2020, "Rom-Com", "Max Barbakow", ["Andy Samberg", "Cristin Milioti"], "Two wedding guests get stuck in the same repeating day together."],
  ["About Time", 2013, "Rom-Com", "Richard Curtis", ["Domhnall Gleeson", "Rachel McAdams"], "A man who can revisit his past learns which moments matter."],
  ["Pride & Prejudice", 2005, "Rom-Com", "Joe Wright", ["Keira Knightley", "Matthew Macfadyen"], "Pride, prejudice, and one very consequential hand flex."],
  ["Set It Up", 2018, "Rom-Com", "Claire Scanlon", ["Zoey Deutch", "Glen Powell"], "Two overworked assistants scheme to matchmake their bosses."],
  ["La La Land", 2016, "Rom-Com", "Damien Chazelle", ["Ryan Gosling", "Emma Stone"], "An actress and a jazz pianist chase dreams that pull them apart."],
  // Comedy
  ["The Grand Budapest Hotel", 2014, "Comedy", "Wes Anderson", ["Ralph Fiennes", "Tony Revolori"], "A legendary concierge and his lobby boy inherit trouble."],
  ["Superbad", 2007, "Comedy", "Greg Mottola", ["Jonah Hill", "Michael Cera"], "One last party stands between two friends and graduation."],
  ["Game Night", 2018, "Comedy", "John Francis Daley", ["Jason Bateman", "Rachel McAdams"], "A murder-mystery party turns out not to be a game."],
  ["The Nice Guys", 2016, "Comedy", "Shane Black", ["Ryan Gosling", "Russell Crowe"], "Two mismatched fixers stumble through 1977 Los Angeles."],
  ["Booksmart", 2019, "Comedy", "Olivia Wilde", ["Beanie Feldstein", "Kaitlyn Dever"], "Two overachievers cram four years of fun into one night."],
  ["Hot Fuzz", 2007, "Comedy", "Edgar Wright", ["Simon Pegg", "Nick Frost"], "A supercop exiled to a sleepy village finds it suspiciously tidy."],
  // Drama
  ["The Shawshank Redemption", 1994, "Drama", "Frank Darabont", ["Tim Robbins", "Morgan Freeman"], "Hope does slow, patient work inside Shawshank's walls."],
  ["Whiplash", 2014, "Drama", "Damien Chazelle", ["Miles Teller", "J.K. Simmons"], "A drummer and a tyrant instructor push each other to the edge."],
  ["The Social Network", 2010, "Drama", "David Fincher", ["Jesse Eisenberg", "Andrew Garfield"], "Building the world's biggest network costs its founder his friends."],
  ["Moonlight", 2016, "Drama", "Barry Jenkins", ["Trevante Rhodes", "Mahershala Ali"], "Three chapters in a Miami boy's search for himself."],
  ["Nomadland", 2020, "Drama", "Chloé Zhao", ["Frances McDormand", "David Strathairn"], "A woman makes the American road her home after loss."],
  ["Past Lives", 2023, "Drama", "Celine Song", ["Greta Lee", "Teo Yoo"], "Childhood sweethearts reunite decades and continents later."],
  ["Spotlight", 2015, "Drama", "Tom McCarthy", ["Mark Ruffalo", "Michael Keaton"], "Reporters uncover an institution's decades of cover-ups."],
  // Action
  ["Mad Max: Fury Road", 2015, "Action", "George Miller", ["Tom Hardy", "Charlize Theron"], "One long chase across a wasteland, and a bid for freedom."],
  ["John Wick", 2014, "Action", "Chad Stahelski", ["Keanu Reeves", "Willem Dafoe"], "A retired hitman returns over a car, a dog, and a promise."],
  ["Mission: Impossible - Fallout", 2018, "Action", "Christopher McQuarrie", ["Tom Cruise", "Henry Cavill"], "Ethan Hunt races stolen plutonium and his own past."],
  ["Top Gun: Maverick", 2022, "Action", "Joseph Kosinski", ["Tom Cruise", "Miles Teller"], "An aging aviator trains the next generation for an impossible run."],
  ["The Dark Knight", 2008, "Action", "Christopher Nolan", ["Christian Bale", "Heath Ledger"], "Gotham's guardian meets an agent of pure chaos."],
  ["Baby Driver", 2017, "Action", "Edgar Wright", ["Ansel Elgort", "Lily James"], "A getaway driver who lives by his playlists wants out."],
  // Horror
  ["Get Out", 2017, "Horror", "Jordan Peele", ["Daniel Kaluuya", "Allison Williams"], "A weekend meeting the girlfriend's parents goes very wrong."],
  ["A Quiet Place", 2018, "Horror", "John Krasinski", ["Emily Blunt", "John Krasinski"], "A family survives by never making a sound."],
  ["Hereditary", 2018, "Horror", "Ari Aster", ["Toni Collette", "Alex Wolff"], "A family inheritance turns out to be much darker than money."],
  ["The Babadook", 2014, "Horror", "Jennifer Kent", ["Essie Davis", "Noah Wiseman"], "A storybook monster feeds on a household's grief."],
  // Animation
  ["Spider-Man: Into the Spider-Verse", 2018, "Animation", "Peter Ramsey", ["Shameik Moore", "Hailee Steinfeld"], "Anyone can wear the mask - even several anyones at once."],
  ["Spirited Away", 2001, "Animation", "Hayao Miyazaki", ["Rumi Hiiragi", "Miyu Irino"], "A girl must work in a spirit bathhouse to free her parents."],
  ["Inside Out", 2015, "Animation", "Pete Docter", ["Amy Poehler", "Phyllis Smith"], "A girl's emotions scramble to steady her through a move."],
  ["Coco", 2017, "Animation", "Lee Unkrich", ["Anthony Gonzalez", "Gael García Bernal"], "A boy crosses into the Land of the Dead to trace his music."],
  // Documentary
  ["Free Solo", 2018, "Documentary", "Jimmy Chin", ["Alex Honnold"], "One climber, one wall, no rope."],
  ["My Octopus Teacher", 2020, "Documentary", "Pippa Ehrlich", ["Craig Foster"], "A year of daily dives builds an unlikely friendship."],
];

// Watch history for user "demo" - the PLANTED TASTE SHIFT.
// [title, genre, rating(1-5), daysAgo]
type Watch = [string, string, number, number];
const watchHistory: Watch[] = [
  // Old era (~6 to ~2 months ago): rom-com/comedy phase, rated high, HIGH VOLUME.
  // Deliberately DEEP (17 rom-coms) so the 180-day window makes Rom-Com WIN
  // decisively, not tie - all of it is 60+ days old, so the 21-day window
  // still sees none of it. That asymmetry is the decay-flip demo.
  ["Notting Hill", "Rom-Com", 5, 180],
  ["Love Actually", "Rom-Com", 5, 176],
  ["When Harry Met Sally", "Rom-Com", 5, 172],
  ["Crazy Rich Asians", "Rom-Com", 4, 165],
  ["You've Got Mail", "Rom-Com", 5, 160],
  ["10 Things I Hate About You", "Rom-Com", 5, 155],
  ["Sleepless in Seattle", "Rom-Com", 5, 150],
  ["The Big Sick", "Rom-Com", 4, 146],
  ["About Time", "Rom-Com", 5, 138],
  ["The Proposal", "Rom-Com", 5, 133],
  ["Pride & Prejudice", "Rom-Com", 5, 129],
  ["Set It Up", "Rom-Com", 4, 120],
  ["Bridget Jones's Diary", "Rom-Com", 5, 116],
  ["La La Land", "Rom-Com", 4, 111],
  ["Game Night", "Comedy", 4, 103],
  ["Always Be My Maybe", "Rom-Com", 5, 99],
  ["Booksmart", "Comedy", 4, 95],
  ["The Grand Budapest Hotel", "Comedy", 5, 88],
  ["27 Dresses", "Rom-Com", 5, 84],
  ["Palm Springs", "Rom-Com", 5, 80],
  ["Superbad", "Comedy", 3, 72],
  ["Hot Fuzz", "Comedy", 4, 65],
  // A few neutral drama watches in between
  ["Past Lives", "Drama", 5, 58],
  ["Spotlight", "Drama", 4, 50],
  // THE SHIFT (last ~3 weeks): sci-fi/thriller kick, rated very high
  ["Interstellar", "Sci-Fi", 5, 20],
  ["Blade Runner 2049", "Sci-Fi", 5, 17],
  ["Ex Machina", "Sci-Fi", 5, 14],
  ["Sicario", "Thriller", 4, 11],
  ["Annihilation", "Sci-Fi", 4, 8],
  ["Prisoners", "Thriller", 5, 6],
  ["Arrival", "Sci-Fi", 5, 4], // ← watched days ago: MUST be excluded from recs
  ["Dune: Part Two", "Sci-Fi", 5, 2], // ← ditto
];

async function ensureIndices() {
  if (!(await es.indices.exists({ index: CATALOG }))) {
    await es.indices.create({
      index: CATALOG,
      mappings: {
        properties: {
          title: { type: "text", fields: { keyword: { type: "keyword" } } },
          year: { type: "integer" },
          genre: { type: "keyword" },
          director: { type: "keyword" },
          actors: { type: "keyword" },
          description: { type: "text" },
          description_semantic: semanticField,
        },
      },
    });
    console.log(`Created ${CATALOG}`);
  }
  if (!(await es.indices.exists({ index: HISTORY }))) {
    await es.indices.create({
      index: HISTORY,
      mappings: {
        properties: {
          user: { type: "keyword" },
          title: { type: "keyword" },
          genre: { type: "keyword" },
          rating: { type: "float" },
          watched_at: { type: "date" },
        },
      },
    });
    console.log(`Created ${HISTORY}`);
  }
}

async function main() {
  await ensureIndices();

  const catalogOps = movies.flatMap(([title, year, genre, director, actors, blurb]) => [
    { index: { _index: CATALOG, _id: `movie-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` } },
    {
      title,
      year,
      genre,
      director,
      actors,
      description: `${blurb} A ${genre.toLowerCase()} directed by ${director}, starring ${actors.join(" and ")}.`,
      description_semantic: `${title} (${year}): ${blurb} ${genre} directed by ${director}, starring ${actors.join(" and ")}.`,
    },
  ]);

  const historyOps = watchHistory.flatMap(([title, genre, rating, age], i) => [
    { index: { _index: HISTORY, _id: `watch-demo-${String(i).padStart(3, "0")}` } },
    { user: "demo", title, genre, rating, watched_at: daysAgo(age) },
  ]);

  // Catalog in small batches (semantic_text inference), history in one go.
  const BATCH = 40;
  for (let i = 0; i < catalogOps.length; i += BATCH * 2) {
    const r = await es.bulk({ operations: catalogOps.slice(i, i + BATCH * 2), refresh: true });
    if (r.errors) console.error("Catalog batch errors at", i / 2);
  }
  const hr = await es.bulk({ operations: historyOps, refresh: true });
  if (hr.errors) console.error("History errors:", JSON.stringify(hr.items.filter((x: any) => x.index?.error).slice(0, 3)));

  console.log(`Seeded ${movies.length} movies into ${CATALOG} and ${watchHistory.length} watches into ${HISTORY}.`);
  console.log("Planted taste shift: rom-com/comedy era (~6-2 months ago) → sci-fi/thriller kick (last ~3 weeks).");
  console.log("Recent watches that recommendations must EXCLUDE: Arrival (4 days ago), Dune: Part Two (2 days ago).");
  console.log("Demo the decay flip: TASTE_DECAY_DAYS=180 (stale rom-com you) vs TASTE_DECAY_DAYS=21 (current sci-fi you).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
