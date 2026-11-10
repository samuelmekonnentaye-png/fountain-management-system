# የሥራ ዕቅድና የአፈጻጸም ሪፖርት ሲስተም (v2)
**FOUNTAIN INTERNATIONAL TRADING PLC** · ፋውንቴን ኢንተርናሽናል ትሬዲንግ ኃ/የተ/የግ/ማህበር

React + Vite · Node.js + Express · MongoDB · JWT · Zod · Liquid Glass UI (ሰማያዊ-ነጭ) · አማርኛ / English

> v2 ሁለት ሲስተሞችን አዋህዷል። ዝርዝሩ (ከየት ምን እንደመጣና ምን እንደተስተካከለ) በ **CHANGES.md** ውስጥ አለ።

---

## 1. ለማስኬድ የሚያስፈልጉ
- Node.js 18 ወይም ከዚያ በላይ
- MongoDB (`mongodb://127.0.0.1:27017`) — ወይም Atlas፤ `server/.env` ውስጥ `MONGO_URI` ይቀይሩ።

## 2. መጫንና ማስጀመር (Windows PowerShell)

```powershell
npm run install:all      # ሁሉንም ፓኬጆች ይጭናል
npm run seed:reset       # የሙከራ ዳታ ይጭናል  ⚠ የድሮውን ዳታ ያጠፋል (ሞዴሉ ስለተቀየረ ግዴታ ነው)
npm run dev              # API :5000 እና Web :5173
```
ከዚያ **http://localhost:5173** ይክፈቱ።

- "running scripts is disabled" ካለ፦ `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` ወይም `npm.cmd` ይጠቀሙ።
- ወደብ 5000 የተያዘ ከሆነ `server/.env` ውስጥ `PORT` እና `client/vite.config.js` ውስጥ ያለውን `target` በአንድ ላይ ይቀይሩ።
- ሙከራዎችን ለማስኬድ፦ `npm test` (28 unit tests፤ ዳታቤዝ አያስፈልግም)።

## 3. የሙከራ መለያዎች
| ኢሜል | የይለፍ ቃል | ሚና |
|---|---|---|
| admin@fountain.com | `Admin@12345` | System Admin |
| gm@fountain.com | `Fountain@123` | General Manager |
| deputy@fountain.com | `Fountain@123` | Deputy General Manager |
| abate@fountain.com | `Fountain@123` | Manager + Department Head |
| selamawit@fountain.com / henok@fountain.com | `Fountain@123` | Department Head |
| samuel@ / meron@ / yonas@ / hana@fountain.com | `Fountain@123` | Employee |

የሳሙኤል የማጽደቂያ ሰንሰለት፦ **ሰላማዊት → አባተ → ዳዊት → ተስፋዬ**። በሙከራ ዳታው ውስጥ የሳሙኤል ግምገማ አሁን ዳዊት ጋር ይጠብቃል፤ የሜሮን ሰላማዊት ጋር፤ የዮናስ ተመልሷል፤ የሀና ጸድቋል።

ሲስተሙን ባዶ ጀምረው ቢመዘገቡ መጀመሪያ የተመዘገበው ሰው በራሱ System Admin ይሆናል። **ከዚያ በኋላ «መለያ ይጠይቁ» የሚሞላ ሰው ሁሉ «በመጠበቅ ላይ» ይሆናል** — System Admin እስኪያጸድቅ መግባት አይችልም። (የሙከራ ዳታው `kidist@fountain.com` የሚባል በመጠበቅ ላይ ያለ ጥያቄ ይዟል።)

## 4. ሲስተሙ እንዴት ይሠራል
1. **የሪፖርት ወቅት** — System Admin ወይም General Manager ወቅት ይፈጥራል (ሳምንት፣ ወር ወይም ብጁ፤ ለምሳሌ «ጥቅምት 2019»)። ወቅቱ ክፍት ሲሆን ብቻ ሪፖርት ይላካል።
2. **ዕቅድ** — ሠራተኛ በወቅቱ ተግባራትን ያስገባል፦ ርዕስ፣ KPI፣ **ግብ (target) + መለኪያ ክፍል (unit)**፣ ክብደት፣ ቀናት። የክብደት ድምር 100% መሆን አለበት።
3. **የዕቅድ ሪፖርት** — ይላካል፤ ይጸድቃል፤ ከጸደቀ በኋላ ዕቅዱ ይቆለፋል።
4. **ግምገማ** — በወቅቱ መጨረሻ ሁኔታና **የተሠራውን መጠን (actual)** ያስገባል። የተገኘው % በራሱ ይሰላል (actual ÷ target)። ያልተሳካ ተግባር **ምክንያት** ይጠይቃል።
5. **የግምገማ ሪፖርት** — ሠራተኛው የአጽዳቂ ዘዴውን ይመርጣል፦
   - **በአለቃ ሰንሰለት (Hierarchical):** በተጠቃሚው `Direct manager` መስክ መሠረት አለቆች በተራ ያጸድቃሉ። ሁሉም ሲያጸድቁ ይጸድቃል።
   - **ቀጥታ (Direct):** ሠራተኛው ተቀባዮችን (Send To) በስም ፍለጋ ይመርጣል፤ የመጀመሪያው ውሳኔ ይጸናል።
   - **CC** ሁልጊዜ ማንበብ ብቻ ነው። BCC የለም።
6. **ውሳኔ** — አጽድቅ · ለማስተካከል መልስ (አስተያየት ግዴታ) · ውድቅ አድርግ (አስተያየት ግዴታ) · አስተላልፍ / አጽዳቂ ጨምር። ውድቅ የተደረገ ሪፖርት ሠራተኛው እንደ ረቂቅ እንደገና ሊከፍተው ይችላል።

### የፐርሰንት ስሌት
- የአንድ ተግባር ውጤት፦ የተጠናቀቀ = 100%፣ ያልተጀመረ/የተሰረዘ = 0%፣ ሌላ = `actual ÷ target` (ከ100% አይበልጥም)።
- **በብዛት:** `የተጠናቀቁ ÷ (ሁሉም − የተሰረዙ) × 100`
- **በክብደት:** `Σ(ክብደት × ውጤት) ÷ Σ ክብደት`
- የተሰረዙ ተግባራት በጭራሽ አይቆጠሩም። የተላከ ሪፖርት ቅጂ (snapshot) ይቀዘቅዛል።

### ሚናዎችና ፈቃዶች
አንድ ሰው **ብዙ ሚና** ሊይዝ ይችላል (ለምሳሌ Manager + Department Head)።

| ሚና | የሚያደርገው |
|---|---|
| Employee | ዕቅድ፣ ግምገማ፣ ሪፖርት መላክ |
| Department Head / Manager | የሚደርሱትን ማጽደቅ፤ የክፍሉንና የቀጥተኛ ሠራተኞቹን ውጤት (ቁጥሮች ብቻ) ማየት |
| Deputy GM | ሪፖርቶችን ማጽደቅ፤ የሁሉንም ክፍሎች ውጤት ማየት |
| General Manager | ከላይ ያሉት + ማንኛውንም ሪፖርት ማንበብ (read-only) + ወቅቶችን ማስተዳደር |
| System Admin | የሲስተም መከታተያ ዳሽቦርድ፤ የምዝገባ ጥያቄዎችን ማጽደቅ/ውድቅ ማድረግ፤ ተጠቃሚዎች፣ ሚናዎች፣ አለቆች፣ ክፍሎች፣ ወቅቶች፣ Audit trail (ዕቅድና ሪፖርት የለውም፤ የሪፖርት ይዘት አያይም) |

## 5. ባህሪዎች
Dashboard · የወቅት ዕቅዶች · ቀጥታ ውጤት ማሳያ · Send To/CC composer · የንባብ ማረጋገጫ · የማጽደቂያ መንገድ ምስል · የዕቅድ እንቅስቃሴ ታሪክ · የቡድን አፈጻጸም (ወቅት/ክፍል ማጣሪያ፣ አዝማሚያ፣ ስርጭት) · **Excel / CSV / Print-PDF** ማውጣት · ማሳወቂያዎችና 5 ዓይነት ማስታወሻዎች (በየ 6 ሰዓት፤ Admin አሁን ማስኬድ ይችላል) · Audit trail · አማርኛ/English።

ደህንነት፦ Zod ማረጋገጫ (ያልተፈቀዱ መስኮች ይጣላሉ) · bcrypt · JWT (የይለፍ ቃል ሲቀየር ቀድሞ ያሉ ቶከኖች ይሰረዛሉ) · rate limit · helmet · የተመሳሳይ ጊዜ ለውጥ ግጭት መከላከያ · የመግቢያ ጊዜ መሸፈኛ · የ CSV formula-injection ጥበቃ · ቢያንስ 10 ቁምፊ የይለፍ ቃል · Admin ለፈጠረው ተጠቃሚ የግዴታ የይለፍ ቃል ለውጥ።

## 5.1 የድርጅቱ ሎጎ
`client/public/` አቃፊ ውስጥ `logo.png` (ወይም `logo.svg`) ብለው ያስቀምጡ፤ ሲስተሙ በራሱ ይጠቀምበታል (ጎን ምናሌ፣ መግቢያ ገጽ፣ የብሮውዘር አዶ)። ከሌለ አብሮ የመጣው ምልክት ይታያል።

## 5.2 የድርጅት ቻርት
አስተዳዳሪ → **የድርጅት ቻርት** → «የድርጅቱን ቻርት ጫን» (አንድ ጊዜ)። ከዚያ በ **ተጠቃሚዎች** ለእያንዳንዱ ሰው ቦታ ይስጡ። የበላዩ (አለቃው) ከቻርቱ በራስ ይወሰናል፤ ሪፖርት በሰንሰለት ሲላክ ወደ ላኪው የራሱ መስመር አጽዳቂዎች ብቻ፣ እስከ ዋና ሥራ አስኪያጅ ድረስ ይሄዳል።

## 5.3 ስብሰባዎች
ክፍል ኃላፊ/ማናጀር → **ስብሰባዎች** → «አዲስ ስብሰባ»፦ ክፍሎችን (ሁሉም ወይም ኃላፊዎች ብቻ) እና ሰዎችን ይጋብዙ፤ የ Zoom አድራሻ ይለጥፉ። ተጋባዦች ማሳወቂያ ይደርሳቸዋል፣ ይቀበላሉ ወይም አይቀበሉም። ከስብሰባ በኋላ ቃለ ጉባኤና ተግባራት ይመዘገባሉ።

## 6. መዋቅር
```
fountain-work-plan-system/
├── package.json  README.md  CHANGES.md
├── server/                      Node + Express + MongoDB
│   ├── .env                     PORT=5000, MONGO_URI, JWT_SECRET, SMTP…
│   └── src/
│       ├── config/              env, db, roles
│       ├── models/              User, Department, ReportingPeriod, WorkPlan, Report, Notification, AuditLog
│       ├── validators/          Zod schemas
│       ├── controllers/         auth, users, departments, periods, plans, reports, dashboard, exports, notifications, audit
│       ├── routes/index.js
│       ├── middleware/          auth, validate, error, rateLimit
│       ├── services/            performance, workflow (ንጹህ ህጎች), reportService, access, analytics, reminders, notify, mailer
│       ├── tests/               unit tests
│       └── seed.js  server.js  app.js
└── client/                      React + Vite
    └── src/ api · context · i18n/am.js · components · pages (+ admin/) · styles · utils
```

## 7. ዋና API (`/api`)
`auth/*` · `users/search` · `users/me/approval-chain` · `users` (Admin) · `departments` · `periods` · `plans` (+`/:id/reopen`) · `reports` (+`inbox|sent|stats|:id|:id/review|:id/forward`) · `notifications` · `dashboard/me|team` · `exports/my-plans|performance|performance.csv|report/:id` · `audit`

## 8. ወደ ምርት ሲሄድ
`NODE_ENV=production`፣ ረጅም `JWT_SECRET`፣ `CLIENT_URL`፣ `ALLOW_REGISTRATION=false` (Admin ብቻ እንዲፈጥር ከፈለጉ)። Frontend፦ `npm run build` → `client/dist`። MongoDB ምትኬ (`mongodump`) በየጊዜው ይውሰዱ። የሙከራ መለያዎችን ያጥፉ።

## 9. የኢትዮጵያ አቆጣጠር
ወቅቶች ብጁ ስም ስለሚይዙ «መስከረም 2019 / ጥቅምት 2019…» የሚሉ ወቅቶችን ከትክክለኛ የጎርጎሪያን ቀናት ጋር (ለምሳሌ ጥቅምት 2019 = Oct 12 – Nov 10, 2026) መፍጠር ይቻላል። ዳሽቦርዶች ሁሉ በወቅት ስም ነው የሚታዩት።

## 10. በኢንተርኔት ላይ ማስተናገድ (Hosting)
GitHub (ኮድ) → MongoDB Atlas (ዳታቤዝ) → Render (API፣ `server` አቃፊ) → Vercel (ድር፣ `client` አቃፊ)።
- Render፦ Root Directory `server`፣ Build `npm install`፣ Start `npm start`፣ Health check `/api/health`። ተለዋዋጮች በ `server/.env.example` ውስጥ ተዘርዝረዋል።
- Vercel፦ Root Directory `client`፣ `VITE_API_URL=https://<የእርስዎ-api>.onrender.com/api`። `client/vercel.json` የገጽ ማደስ ችግርን ይፈታል።
- ዳታቤዙ ባዶ ስለሚሆን የመጀመሪያውን አስተዳዳሪ ይፍጠሩ፦ `npm run create-admin -- "ሙሉ ስም" admin@company.com 'ጠንካራ-የይለፍ-ቃል1'`
- ኦንላይን **የሙከራ ዳታ (`seed`) አይጫኑ**፤ ዝርዝሩን በቻቱ የሰጠሁትን ደረጃ በደረጃ መመሪያ ይከተሉ።
