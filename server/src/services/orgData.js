// FOUNTAIN INTERNATIONAL TRADING PLC - organisational structure (from the company's organisation chart).
// Pure data: units (departments) and positions. "parent" = the position it reports to.
//   approver : the holder may approve reports of people below (false for advisors, experts, officers, teams ...)
//   chainEnd : reports from below stop here (General Manager); positions above are not in the chain
//   seats    : number of people in the chart box, e.g. "Supervisors (5)"

export const ORG_UNITS = [
  { name: 'Executive Office', nameAm: 'ሥራ አስፈጻሚ ጽ/ቤት', parent: null },
  { name: "Deputy General Manager's Office", nameAm: 'የምክትል ዋና ሥራ አስኪያጅ ጽ/ቤት', parent: 'Executive Office' },
  { name: 'Information Technology', nameAm: 'የመረጃ ቴክኖሎጂ', parent: 'Executive Office' },
  { name: 'Marketing & Customer Relations', nameAm: 'ግብይትና ደንበኞች ግንኙነት', parent: 'Executive Office' },
  { name: 'Finance', nameAm: 'ፋይናንስ', parent: 'Executive Office' },
  { name: 'Security Section', nameAm: 'የጥበቃ ክፍል', parent: "Deputy General Manager's Office" },
  { name: 'Cleaning & HR Supply Service', nameAm: 'ጽዳትና የሰው ኃይል አቅርቦት አገልግሎት', parent: "Deputy General Manager's Office" },
  { name: 'General Services & Property Administration', nameAm: 'ጠቅላላ አገልግሎትና ንብረት አስተዳደር', parent: "Deputy General Manager's Office" },
  { name: 'Human Resource', nameAm: 'የሰው ሀብት', parent: "Deputy General Manager's Office" },
];

const P = (name, nameAm, parent, unit, o = {}) => ({
  name, nameAm, parent, unit, approver: o.approver ?? false, chainEnd: o.chainEnd ?? false, seats: o.seats ?? 1,
});
const EX = 'Executive Office';
const DGMO = "Deputy General Manager's Office";
const SEC = 'Security Section';
const CLN = 'Cleaning & HR Supply Service';
const GS = 'General Services & Property Administration';
const HR = 'Human Resource';

// Parents always come before their children.
export const ORG_POSITIONS = [
  // ---- top
  P('Managing Director (MD)', 'ማኔጂንግ ዳይሬክተር', null, EX, { approver: true }),
  P('Internal Auditor', 'የውስጥ ኦዲተር', 'Managing Director (MD)', EX),
  P('General Manager (GM)', 'ዋና ሥራ አስኪያጅ', 'Managing Director (MD)', EX, { approver: true, chainEnd: true }),
  P('Legal Advisor', 'የሕግ አማካሪ', 'General Manager (GM)', EX),
  P('Executive Secretary', 'ሥራ አስፈጻሚ ጸሐፊ', 'General Manager (GM)', EX),
  P('IT Senior Supervisor', 'የመረጃ ቴክኖሎጂ ከፍተኛ ተቆጣጣሪ', 'General Manager (GM)', 'Information Technology', { approver: true }),

  // ---- marketing
  P('Marketing & Customer Relations Department Head', 'የግብይትና ደንበኞች ግንኙነት ዋና ክፍል ኃላፊ', 'General Manager (GM)', 'Marketing & Customer Relations', { approver: true }),
  P('Bid Preparation Expert', 'የጨረታ ዝግጅት ባለሙያ', 'Marketing & Customer Relations Department Head', 'Marketing & Customer Relations'),
  P('Business Development and Customer Relation Expert', 'የቢዝነስ ልማትና ደንበኞች ግንኙነት ባለሙያ', 'Marketing & Customer Relations Department Head', 'Marketing & Customer Relations'),

  // ---- finance
  P('Finance Department Head', 'የፋይናንስ ዋና ክፍል ኃላፊ', 'General Manager (GM)', 'Finance', { approver: true }),
  P('Finance Advisor', 'የፋይናንስ አማካሪ', 'Finance Department Head', 'Finance'),
  P('Accounting Team', 'የሂሳብ ቡድን', 'Finance Department Head', 'Finance', { seats: 3 }),
  P('Revenue Collection Team', 'የገቢ አሰባሰብ ቡድን', 'Finance Department Head', 'Finance', { seats: 2 }),
  P('Payable Team', 'የክፍያ ቡድን', 'Finance Department Head', 'Finance'),

  // ---- deputy general manager and the four operation lines below
  P('Deputy General Manager', 'ምክትል ዋና ሥራ አስኪያጅ', 'General Manager (GM)', DGMO, { approver: true }),
  P('Consultant', 'አማካሪ', 'Deputy General Manager', DGMO),
  P('Secretary', 'ጸሐፊ', 'Deputy General Manager', DGMO),

  // ---- security section
  P('Security Section Operation Manager', 'የጥበቃ ክፍል ኦፕሬሽን ሥራ አስኪያጅ', 'Deputy General Manager', SEC, { approver: true }),
  P('Messenger', 'መልዕክተኛ', 'Security Section Operation Manager', SEC),
  P('Research and Planning Section Head', 'የምርምርና ዕቅድ ክፍል ኃላፊ', 'Security Section Operation Manager', SEC, { approver: true }),
  P('District Operation Section Head (Security)', 'የዲስትሪክት ኦፕሬሽን ክፍል ኃላፊ (ጥበቃ)', 'Security Section Operation Manager', SEC, { approver: true, seats: 5 }),
  P('Supervisors (District Operation)', 'ተቆጣጣሪዎች (ዲስትሪክት ኦፕሬሽን)', 'District Operation Section Head (Security)', SEC, { approver: true, seats: 5 }),
  P('Shift Leaders', 'የፈረቃ መሪዎች', 'Supervisors (District Operation)', SEC),
  P('Deputy Security Section Operation Manager', 'የጥበቃ ክፍል ኦፕሬሽን ምክትል ሥራ አስኪያጅ', 'Security Section Operation Manager', SEC, { approver: true }),
  P('Technical Training & Development Section Head', 'የቴክኒክ ሥልጠናና ልማት ክፍል ኃላፊ', 'Deputy Security Section Operation Manager', SEC, { approver: true }),
  P('Documentation & Distribution Section Head', 'የሰነድና ስርጭት ክፍል ኃላፊ', 'Deputy Security Section Operation Manager', SEC, { approver: true }),
  P('Financial Institution Operation Section Head', 'የፋይናንስ ተቋማት ኦፕሬሽን ክፍል ኃላፊ', 'Deputy Security Section Operation Manager', SEC, { approver: true }),
  P('Supervisors (Financial Institution)', 'ተቆጣጣሪዎች (ፋይናንስ ተቋማት)', 'Financial Institution Operation Section Head', SEC, { approver: true, seats: 6 }),
  P('Non-Financial Institution Operation Section Head', 'የፋይናንስ ያልሆኑ ተቋማት ኦፕሬሽን ክፍል ኃላፊ', 'Deputy Security Section Operation Manager', SEC, { approver: true }),
  P('Supervisors (Non-Financial Institution)', 'ተቆጣጣሪዎች (ፋይናንስ ያልሆኑ ተቋማት)', 'Non-Financial Institution Operation Section Head', SEC, { approver: true, seats: 4 }),

  // ---- cleaning and HR supply service
  P('Cleaning and HR Supply Service Operation Manager', 'የጽዳትና የሰው ኃይል አቅርቦት አገልግሎት ኦፕሬሽን ሥራ አስኪያጅ', 'Deputy General Manager', CLN, { approver: true }),
  P('Customer Support & Supplies Distribution Section Head', 'የደንበኛ ድጋፍና አቅርቦት ስርጭት ክፍል ኃላፊ', 'Cleaning and HR Supply Service Operation Manager', CLN, { approver: true }),
  P('HR Follow-up & Monitoring Section Head', 'የሰው ኃይል ክትትልና ቁጥጥር ክፍል ኃላፊ', 'Cleaning and HR Supply Service Operation Manager', CLN, { approver: true }),
  P('District Operation Section Head (Cleaning)', 'የዲስትሪክት ኦፕሬሽን ክፍል ኃላፊ (ጽዳት)', 'Cleaning and HR Supply Service Operation Manager', CLN, { approver: true }),
  P('Technical Training & Development Officer', 'የቴክኒክ ሥልጠናና ልማት ኦፊሰር', 'Cleaning and HR Supply Service Operation Manager', CLN),
  P('Area Supervisors', 'የአካባቢ ተቆጣጣሪዎች', 'Cleaning and HR Supply Service Operation Manager', CLN),

  // ---- general services and property administration
  P('GS & Property Admin Section Head', 'የጠቅላላ አገልግሎትና ንብረት አስተዳደር ክፍል ኃላፊ', 'Deputy General Manager', GS, { approver: true }),
  P('Logistics & Store Head', 'የሎጂስቲክስና ስቶር ኃላፊ', 'GS & Property Admin Section Head', GS, { approver: true }),
  P('Fleet Officer', 'የተሽከርካሪ አስተዳደር ኦፊሰር', 'GS & Property Admin Section Head', GS),
  P('Procurement Officer', 'የግዥ ኦፊሰር', 'GS & Property Admin Section Head', GS),
  P('Liaison Officer', 'የግንኙነት ኦፊሰር', 'GS & Property Admin Section Head', GS),

  // ---- human resource
  P('Human Resource Manager (HRM)', 'የሰው ሀብት ሥራ አስኪያጅ', 'Deputy General Manager', HR, { approver: true }),
  P('Customer Support & HR Section Head', 'የደንበኛ ድጋፍና የሰው ሀብት ክፍል ኃላፊ', 'Human Resource Manager (HRM)', HR, { approver: true }),
  P('Cleaning Section HR Team Leader', 'የጽዳት ክፍል የሰው ሀብት ቡድን መሪ', 'Human Resource Manager (HRM)', HR),
  P('Security Section HR Team Leader', 'የጥበቃ ክፍል የሰው ሀብት ቡድን መሪ', 'Human Resource Manager (HRM)', HR),
  P('Capacity Building Supervisor', 'የአቅም ግንባታ ተቆጣጣሪ', 'Human Resource Manager (HRM)', HR),
];
