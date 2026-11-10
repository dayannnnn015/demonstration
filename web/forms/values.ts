// The report card's observed values, as the school's Grades 4–6 card prints
// them: four core values, seven behaviour statements, each marked per term.

export const coreValues: { value: string; statements: { code: string; text: string }[] }[] = [
  { value: '1. Maka-Diyos', statements: [
    { code: 'MD1', text: 'Expresses one’s spiritual beliefs while respecting the spiritual beliefs of others' },
    { code: 'MD2', text: 'Shows adherence to ethical principles by upholding the truth' },
  ] },
  { value: '2. Makatao', statements: [
    { code: 'MT1', text: 'Is sensitive to individual, social, and cultural differences' },
    { code: 'MT2', text: 'Demonstrates contributions toward solidarity' },
  ] },
  { value: '3. Makakalikasan', statements: [
    { code: 'MK1', text: 'Cares for the environment and utilize resources wisely, judiciously, and economically' },
  ] },
  { value: '4. Makabansa', statements: [
    { code: 'MB1', text: 'Demonstrates pride in being a Filipino; exercise the rights and responsibilities of a Filipino citizen' },
    { code: 'MB2', text: 'Demonstrates appropriate behavior in carrying out activities in the school, community and country' },
  ] },
];
export const valueCodes = coreValues.flatMap(v => v.statements.map(s => s.code));
export const marks: [string, string][] = [['AO', 'Always Observed'], ['SO', 'Sometimes Observed'], ['RO', 'Rarely Observed'], ['NO', 'Not Observed']];
