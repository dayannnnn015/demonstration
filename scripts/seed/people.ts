/**
 * Invented people for the seeded school: names that read like a Benguet
 * school's, and the hidden traits that keep each learner's record consistent
 * with itself — a learner who misses school often also scores lower, is marked
 * lower on the observed values, and gets the comment an adviser would write.
 *
 * Every name is made up. None is meant to be anyone, and famous Benguet family
 * names are left out so none reads as someone in particular. The records are
 * still invented: the seeded-data banner says so on every screen, and the
 * go-live wipe removes them.
 */

export const girls = ['Aileen', 'Alyssa', 'Angela', 'Angelica', 'April', 'Ashley', 'Bea', 'Bernadette', 'Camille', 'Carmela', 'Charlene', 'Cherry', 'Christine', 'Clarisse',
  'Daisy', 'Danica', 'Divine', 'Ella', 'Erica', 'Faith', 'Gabrielle', 'Grace', 'Hannah', 'Hazel', 'Irish', 'Isabel', 'Jamaica', 'Janelle', 'Jasmine', 'Jean', 'Jessa', 'Joanna',
  'Julia', 'Kate', 'Katrina', 'Kim', 'Kristine', 'Lara', 'Leah', 'Lovely', 'Lyka', 'Maria', 'Mariel', 'Mary Grace', 'Mary Joy', 'Maxine', 'Mia', 'Nicole', 'Patricia', 'Pauline',
  'Princess', 'Rachelle', 'Rhea', 'Rica', 'Rose Ann', 'Samantha', 'Sarah', 'Shaira', 'Sophia', 'Stephanie', 'Trisha', 'Vanessa', 'Ysabel', 'Zia', 'Althea', 'Andrea', 'Bianca',
  'Chloe', 'Jillian', 'Kyla', 'Nathalie', 'Rhianne', 'Arlyn', 'Merlyn', 'Juvy', 'Shiela'];
export const boys = ['Aaron', 'Adrian', 'Aldrin', 'Allen', 'Andrei', 'Angelo', 'Bryan', 'Carl', 'Christian', 'Clark', 'Daniel', 'Darren', 'Dave', 'Dominic', 'Earl', 'Edward',
  'Elijah', 'Emmanuel', 'Ethan', 'Francis', 'Gabriel', 'Gerald', 'Harold', 'Ian', 'Ivan', 'Jacob', 'James', 'Jansen', 'Jared', 'Jason', 'Jayson', 'Jerome', 'John Carlo',
  'John Lloyd', 'John Paul', 'Joshua', 'Justin', 'Kenneth', 'Kevin', 'Kurt', 'Lance', 'Lawrence', 'Leo', 'Lester', 'Marc', 'Mark Anthony', 'Matthew', 'Michael', 'Miguel',
  'Nathan', 'Neil', 'Nico', 'Noel', 'Patrick', 'Paul', 'Prince', 'Raphael', 'Raymond', 'Renz', 'Rey', 'Ronald', 'Ryan', 'Samuel', 'Sean', 'Simon', 'Stephen', 'Tristan', 'Vince',
  'Xander', 'Zion', 'Alvin', 'Benjie', 'Dexter', 'Jomar', 'Rodel', 'Wendell'];
/** Ibaloi, Kankanaey and Ilocano surnames common around La Trinidad, with the usual Filipino ones. */
export const surnames = ['Ayochok', 'Bangsoy', 'Bayangan', 'Bentican', 'Bilog', 'Buyagan', 'Cayat', 'Dagupen', 'Dalisay', 'Dongbo', 'Dulnuan', 'Dumalsin', 'Fianza', 'Gawidan',
  'Gayao', 'Guinaang', 'Kipaan', 'Kiwas', 'Labi', 'Lamsis', 'Lumas-ang', 'Mangili', 'Oblas', 'Pacio', 'Palaos', 'Sagayo', 'Saley', 'Tabangin', 'Ticbaen', 'Tumpap', 'Wakit',
  'Abellera', 'Agustin', 'Aquino', 'Bautista', 'Castillo', 'Cruz', 'Dela Cruz', 'Domingo', 'Esteban', 'Fernandez', 'Galang', 'Garcia', 'Gonzales', 'Lagman', 'Mariano',
  'Mendoza', 'Navarro', 'Pascual', 'Ramos', 'Reyes', 'Santos', 'Soriano', 'Tadeo', 'Torres', 'Valdez', 'Villanueva', 'Alipio', 'Ananayo', 'Balanza', 'Bulayo', 'Calpito',
  'Damaso', 'Erfe', 'Fontanilla', 'Gumabay', 'Lartec', 'Licnachan', 'Lingbawan', 'Mayamnes', 'Ognayon', 'Pumecha', 'Sacla', 'Sapdoy', 'Tigo', 'Tomas', 'Wasit'];
const adultWomen = ['Rowena', 'Maricel', 'Jocelyn', 'Marites', 'Josephine', 'Elvira', 'Leonora', 'Victoria', 'Teresita', 'Rosalinda', 'Analyn', 'Gemma', 'Liza', 'Norma',
  'Evelyn', 'Melody', 'Arlene', 'Gloria', 'Wilma', 'Felicidad', 'Imelda', 'Corazon', 'Lourdes', 'Mylene', 'Jennifer', 'Sheryl'];
const adultMen = ['Arnel', 'Rodelio', 'Rogelio', 'Ernesto', 'Fernando', 'Jerry', 'Romeo', 'Danilo', 'Alfredo', 'Wilfredo', 'Benjamin', 'Ricardo'];

export function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A standard normal draw from a uniform source. */
export const normal = (next: () => number) => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
const pick = <T>(list: readonly T[], next: () => number) => list[Math.floor(next() * list.length)]!;
export const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/** Staff names as a school writes them on a form: given name, middle initial, surname. */
export function staffNames(count: number, seed = 20260608) {
  const next = random(seed), used = new Set<string>(), out: { name: string; sex: 'female' | 'male'; email: string }[] = [];
  while (out.length < count) {
    // Most elementary teachers in the division are women; a few are men.
    const sex = next() < 0.82 ? 'female' : 'male';
    const given = pick(sex === 'female' ? adultWomen : adultMen, next), last = pick(surnames, next), middle = pick(surnames, next);
    const name = `${given} ${middle[0]}. ${last}`;
    if (used.has(given + last) || middle === last) continue;
    used.add(given + last);
    const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z]+/g, '');
    out.push({ name, sex, email: `${slug(given)}.${slug(last)}` });
  }
  return out;
}

/**
 * One learner's hidden traits. `ability` moves every grade; `absence` is the
 * chance of missing a day, higher for a learner who also struggles; `late` the
 * chance of a half day; `streak` a run of days off sick, the kind an adviser
 * follows up.
 */
export type Traits = { ability: number; absence: number; late: number; streak: boolean; overage: boolean };

export type Family = { last: string; middle: string | null };
export type Child = { first: string; middle: string | null; last: string; extension: string | null; sex: 'female' | 'male'; birth: string; traits: Traits };

/**
 * The learners of one grade. About one in five shares a family with a learner
 * in another grade, so brothers and sisters carry the same surname and middle
 * name; a mother's maiden name is the middle name, and a few have none on file.
 */
export function children(grade: number, count: number, families: Family[], seed: number): Child[] {
  const next = random(seed), out: Child[] = [];
  const startYear = 2026;
  for (let i = 0; i < count; i++) {
    const sex = next() < 0.49 ? 'female' : 'male';
    let family: Family;
    if (families.length > 20 && next() < 0.2) family = pick(families, next);
    else {
      family = { last: pick(surnames, next), middle: next() < 0.93 ? pick(surnames, next) : null };
      if (family.middle === family.last) family.middle = pick(surnames, next);
      families.push(family);
    }
    const ability = normal(next);
    const struggle = clamp(-ability, -1.5, 2.5);
    const overage = next() < 0.04 + (ability < -1 ? 0.06 : 0);
    // Six by the end of August for Grade 1, five for Kinder: born September to August, a year earlier if overage.
    const born = new Date(Date.UTC(startYear - 6 - grade - (overage ? 1 : 0), 8, 1) + Math.floor(next() * 365) * 86400000).toISOString().slice(0, 10);
    const chronic = next() < 0.05 + (struggle > 1 ? 0.07 : 0);
    const absence = clamp(0.018 + 0.012 * normal(next) + 0.008 * struggle + (chronic ? 0.07 + next() * 0.06 : 0), 0.002, 0.25);
    const first = pick(sex === 'female' ? girls : boys, next);
    out.push({
      first, middle: family.middle, last: family.last, sex, birth: born,
      extension: sex === 'male' && next() < 0.03 ? pick(['Jr.', 'II', 'III'], next) : null,
      traits: { ability, absence, late: clamp(0.006 + 0.006 * normal(next) + (chronic ? 0.01 : 0), 0, 0.05), streak: chronic && next() < 0.5, overage },
    });
  }
  return out;
}

/** A twelve-digit LRN in the usual shape: the school's ID, the year the learner first enrolled, and a sequence. */
export const lrn = (grade: number, sequence: number) => `135617${String((2026 - grade - (grade === 0 ? 0 : 1)) % 100).padStart(2, '0')}${String(sequence).padStart(4, '0')}`;

/**
 * A term grade an ECR might show for this learner in this learning area:
 * around 81, moved by ability, by attendance, by how the learner takes to the
 * area and by the term. These are invented the way a class record would show
 * them; EDUNEXUS itself computes no grade.
 */
export function termGrade(traits: Traits, area: number, term: number, next: () => number) {
  // Elementary grades run high and few learners fail: around 85, so only the weakest and most often absent fall below 75.
  const raw = 85 + 5 * traits.ability + area + (term - 1) * 0.5 - 50 * Math.max(0, traits.absence - 0.04) + 1.4 * normal(next);
  return Math.round(clamp(raw, 70, 99));
}

/** An observed-value mark for one behaviour statement: better attenders and stronger learners are marked AO more often. */
export function valueMark(traits: Traits, next: () => number) {
  const score = 0.5 * traits.ability - 12 * Math.max(0, traits.absence - 0.03) + 0.8 * normal(next);
  return score > 0.25 ? 'AO' : score > -1 ? 'SO' : score > -2.4 ? 'RO' : 'NO';
}

const his = (sex: 'female' | 'male') => (sex === 'female' ? 'her' : 'his');
const he = (sex: 'female' | 'male') => (sex === 'female' ? 'She' : 'He');

/** The teacher's comment a Grades 2–3 card carries, in the adviser's words for this learner this term. */
export function comment(child: Pick<Child, 'first' | 'sex' | 'traits'>, term: number, next: () => number) {
  const { first, sex, traits } = child;
  if (traits.absence > 0.07) return pick([`${first} missed several days this term. Coming to school every day will help ${his(sex)} catch up.`,
    `${first} is capable but was often absent. Please help ${his(sex)} attend regularly.`], next);
  if (traits.ability > 1) return pick([`${first} reads fluently and finishes ${his(sex)} work ahead of time. ${he(sex)} also helps classmates.`,
    `${first} is an active and confident learner. Keep encouraging ${his(sex)} reading at home.`, `Excellent work this term, ${first}! ${he(sex)} leads well in group activities.`], next);
  if (traits.ability > -0.4) return pick([`${first} participates well and is steadily improving${term > 1 ? ' since last term' : ''}.`,
    `${first} works well with ${his(sex)} classmates. More practice in solving word problems will help.`, `${first} is attentive in class and completes ${his(sex)} tasks.`], next);
  return pick([`${first} needs more practice in reading. Fifteen minutes of reading at home each day will help.`,
    `${first} is trying hard. ${he(sex)} needs support in Mathematics, especially in subtraction with regrouping.`], next);
}

/** The Grade 1 card's two narratives for a term, by how the learner is doing. */
export function narratives(child: Pick<Child, 'first' | 'sex' | 'traits'>, next: () => number) {
  const { first, sex, traits } = child;
  const can = traits.ability > 0.8
    ? [`${first} reads short stories on ${his(sex)} own and counts objects up to 100.`, `${first} writes simple sentences and explains ${his(sex)} answers clearly.`]
    : traits.ability > -0.6
      ? [`${first} recognizes the letters and their sounds and counts up to 50.`, `${first} follows classroom routines and takes turns in group work.`]
      : [`${first} names the letters of the alphabet and counts objects up to 20.`, `${first} enjoys listening to stories and joins in songs and games.`];
  const improve = traits.absence > 0.07
    ? [`Coming to school every day, so ${first} does not miss lessons.`]
    : traits.ability > 0.8
      ? ['Writing neatly on the lines.', 'Waiting for a turn to speak in class.']
      : ['Blending sounds to read simple words.', 'Adding and subtracting numbers up to 20.', 'Writing letters on the lines.'];
  return { can_do: pick(can, next), to_improve: pick(improve, next) };
}
