const fs = require('fs');
const path = require('path');

const FEED_PATH = 'X:\\PolyTabRepo\\docs\\feed.json';
const OUT_MASTER = 'X:\\PolyTabRepo\\docs\\data\\global-charities.json';

// Category-compartmentalized numeric ID blocks (structured, reflects category, wallet-compatible)
// Only site-valid categories are used.
const CAT_BLOCK = {
  'Accessibility & Universal Design': 10000,
  'Environmental': 20000,
  'Civic Tech': 30000,
  'Classrooms': 40000,
  'Arts & Clubs': 45000,
  'Campus Grounds': 60000,
  'Athletics': 70000
};
const VALID_CATEGORIES = new Set(Object.keys(CAT_BLOCK));

// All unclaimed bounties route to the shared Polytab-managed escrow on Base
const ESCROW_WALLET = '0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08';
function walletFor(_id) { return ESCROW_WALLET; }

function block(category, org, title, location, lat, lng, website, socials, summary, plainSummary, targetUSD) {
  const cat = VALID_CATEGORIES.has(category) ? category : 'Civic Tech';
  const idNum = nextId(cat);
  const id = String(idNum);
  return {
    id,
    title,
    content_html: '<p>' + summary + '</p>',
    url: 'https://polytab.store/#' + id,
    date_published: '2026-11-10T00:00:00Z',
    _polytab: {
      category: cat,
      organization: org,
      location,
      summary,
      plainSummary,
      votePriceUSD: 0.5,
      targetUSD: targetUSD || 500,
      fundedUSD: 0,
      votesCount: 0,
      contract: walletFor(id),
      status: 'Active',
      lat: lat == null ? null : lat,
      lng: lng == null ? null : lng,
      website: website || null,
      socials: socials || {}
    }
  };
}

const counters = {};
function nextId(category) {
  const base = CAT_BLOCK[category] || 80000;
  counters[base] = (counters[base] || 0) + 1;
  return base + counters[base];
}

// Curated global charities: real public organizations, public HQ coords, real websites/socials.
// All honest-zero (fundedUSD 0, votesCount 0). Actions framed as support outcomes.
const GLOBAL = [
  // Accessibility & Universal Design
  ['Accessibility & Universal Design','World Health Organization (WHO)','Support Global Assistive Technology Access','Geneva, Switzerland',46.2327,6.1340,'https://www.who.int',{x:'https://x.com/WHO',facebook:'https://www.facebook.com/WHO',instagram:'https://www.instagram.com/who',linkedin:'https://www.linkedin.com/company/world-health-organization',youtube:'https://www.youtube.com/user/who'},'Support equitable access to assistive products (wheelchairs, hearing aids, vision aids) for people with disabilities worldwide.','Cause: Over 2.5 billion people need assistive products but many lack access.\nResolution: Fund procurement and delivery partnerships for assistive technology.\nProof: WHO program reports and delivery documentation.',750],
  ['Accessibility & Universal Design','International Disability Alliance','Advance Disability Rights & Inclusive Policy','Geneva, Switzerland',46.2044,6.1432,'https://www.internationaldisabilityalliance.org',{x:'https://x.com/IDA_CRPD_Forum',facebook:'https://www.facebook.com/InternationalDisabilityAlliance'},'Strengthen global advocacy so persons with disabilities can participate fully in civic and community life.','Cause: Persons with disabilities face systemic barriers to participation.\nResolution: Support rights-based advocacy and inclusion initiatives.\nProof: Published advocacy outcomes and partner reports.',500],
  ['Accessibility & Universal Design','CBM Global Disability Inclusion','Inclusive Health & Rehabilitation Support','Laudenbach, Germany',49.6114,8.6533,'https://cbm-global.org',{x:'https://x.com/CBMGlobal',facebook:'https://www.facebook.com/CBMGlobal',linkedin:'https://www.linkedin.com/company/cbm-global-disability-inclusion'},'Deliver inclusive eye health, rehabilitation, and community-based support for people with disabilities in low-income regions.','Cause: Preventable blindness and lack of rehab services limit independence.\nResolution: Fund inclusive health and rehabilitation programs.\nProof: Program delivery and clinical outcome reports.',600],
  ['Accessibility & Universal Design','Humanity & Inclusion (HI)','Assistive Mobility & Rehabilitation Aid','Lyon, France',45.7640,4.8357,'https://www.hi-us.org',{x:'https://x.com/HI_UnitedStates',facebook:'https://www.facebook.com/HIunitedstates',instagram:'https://www.instagram.com/humanity_and_inclusion',linkedin:'https://www.linkedin.com/company/humanity-&-inclusion'},'Provide mobility devices, rehabilitation, and inclusion support for people with disabilities in crisis and development settings.','Cause: Conflict and poverty leave people without mobility and rehab.\nResolution: Supply assistive devices and rehabilitation services.\nProof: Distribution records and field program reports.',600],
  ['Accessibility & Universal Design','Sightsavers','Prevent Blindness & Restore Sight','Haywards Heath, United Kingdom',50.9990,-0.1062,'https://www.sightsavers.org',{x:'https://x.com/Sightsavers',facebook:'https://www.facebook.com/Sightsavers',instagram:'https://www.instagram.com/sightsavers',linkedin:'https://www.linkedin.com/company/sightsavers',youtube:'https://www.youtube.com/user/sightsaversTV'},'Fund sight-saving treatments and inclusive eye health services to prevent avoidable blindness.','Cause: Millions lose sight to preventable or treatable conditions.\nResolution: Support screenings, surgeries, and treatments.\nProof: Treatment counts and program audits.',500],
  ['Accessibility & Universal Design','Light for the World','Inclusive Eye Health & Disability Rights','Vienna, Austria',48.2082,16.3738,'https://www.light-for-the-world.org',{x:'https://x.com/lftwworldwide',facebook:'https://www.facebook.com/lightfortheworldint',linkedin:'https://www.linkedin.com/company/light-for-the-world'},'Improve eye health and promote the rights of people with disabilities in underserved communities.','Cause: Avoidable blindness and exclusion persist without access to care.\nResolution: Fund inclusive eye health and advocacy programs.\nProof: Clinical and program outcome reports.',500],
  ['Accessibility & Universal Design','The Fred Hollows Foundation','End Avoidable Blindness','Sydney, Australia',-33.8688,151.2093,'https://www.hollows.org',{x:'https://x.com/FredHollows',facebook:'https://www.facebook.com/FredHollows',instagram:'https://www.instagram.com/fredhollows',youtube:'https://www.youtube.com/user/FredHollows'},'Restore sight through cataract surgeries, training, and affordable eye care.','Cause: Cataract and treatable eye disease cause needless blindness.\nResolution: Fund surgeries, equipment, and local training.\nProof: Surgery and training records.',500],

  // Environmental
  ['Environmental','World Wide Fund for Nature (WWF)','Protect Wildlife & Restore Ecosystems','Gland, Switzerland',46.4203,6.2701,'https://www.worldwildlife.org',{x:'https://x.com/World_Wildlife',facebook:'https://www.facebook.com/worldwildlifefund',instagram:'https://www.instagram.com/world_wildlife',youtube:'https://www.youtube.com/user/worldwildlifefund'},'Conserve critical habitats and species through science-based protection and restoration.','Cause: Habitat loss and climate pressure threaten biodiversity.\nResolution: Fund habitat protection and restoration projects.\nProof: Conservation monitoring and field reports.',750],
  ['Environmental','The Nature Conservancy','Conserve Lands & Waters','Arlington, VA, USA',38.8816,-77.1043,'https://www.nature.org',{x:'https://x.com/nature_org',facebook:'https://www.facebook.com/thenatureconservancy',instagram:'https://www.instagram.com/nature_org',linkedin:'https://www.linkedin.com/company/the-nature-conservancy'},'Protect and restore lands and waters to sustain biodiversity and climate resilience.','Cause: Ecosystems face degradation and climate stress.\nResolution: Fund land and water conservation initiatives.\nProof: Protected-area and restoration reporting.',750],
  ['Environmental','Conservation International','Safeguard Nature for People','Arlington, VA, USA',38.8904,-77.0840,'https://www.conservation.org',{x:'https://x.com/ConservationOrg',facebook:'https://www.facebook.com/conservation.intl',instagram:'https://www.instagram.com/conservationorg',linkedin:'https://www.linkedin.com/company/conservation-international'},'Protect forests, oceans, and biodiversity that communities rely on.','Cause: Nature loss undermines climate and livelihoods.\nResolution: Fund conservation and community resilience programs.\nProof: Conservation outcome reports.',600],
  ['Environmental','Ocean Conservancy','Protect Oceans from Pollution','Washington, DC, USA',38.9029,-77.0310,'https://oceanconservancy.org',{x:'https://x.com/OurOcean',facebook:'https://www.facebook.com/oceanconservancy',instagram:'https://www.instagram.com/oceanconservancy'},'Reduce ocean plastic and protect marine ecosystems through cleanup and policy action.','Cause: Plastic and pollution harm marine life and coasts.\nResolution: Fund cleanup, prevention, and advocacy programs.\nProof: Cleanup data and program reports.',500],
  ['Environmental','WaterAid','Clean Water, Sanitation & Hygiene','London, United Kingdom',51.5074,-0.1278,'https://www.wateraid.org',{x:'https://x.com/wateraid',facebook:'https://www.facebook.com/wateraid',instagram:'https://www.instagram.com/wateraid',youtube:'https://www.youtube.com/user/WaterAid'},'Deliver clean water, toilets, and hygiene to communities lacking basic services.','Cause: Millions lack safe water and sanitation.\nResolution: Fund water points, sanitation, and hygiene education.\nProof: Infrastructure delivery and impact reports.',600],
  ['Environmental','charity: water','Bring Clean Drinking Water','New York, NY, USA',40.7128,-74.0060,'https://www.charitywater.org',{x:'https://x.com/charitywater',facebook:'https://www.facebook.com/charitywater',instagram:'https://www.instagram.com/charitywater',youtube:'https://www.youtube.com/user/charitywater'},'Fund sustainable clean water projects for communities without reliable access.','Cause: Communities lack safe, reliable drinking water.\nResolution: Fund wells and water systems.\nProof: Project completion and GPS-tagged reporting.',500],

  // Civic Tech / Rights
  ['Civic Tech','Wikimedia Foundation','Keep Free Knowledge Open','San Francisco, CA, USA',37.7869,-122.3997,'https://wikimediafoundation.org',{x:'https://x.com/Wikimedia',facebook:'https://www.facebook.com/wikimediafoundation',instagram:'https://www.instagram.com/wikimediafoundation',linkedin:'https://www.linkedin.com/company/wikimedia-foundation'},'Sustain open, freely accessible knowledge infrastructure for everyone.','Cause: Reliable knowledge access is uneven and costly.\nResolution: Support open knowledge platforms and tools.\nProof: Public infrastructure and transparency reports.',500],
  ['Civic Tech','Electronic Frontier Foundation (EFF)','Defend Digital Rights & Privacy','San Francisco, CA, USA',37.7753,-122.4129,'https://www.eff.org',{x:'https://x.com/EFF',facebook:'https://www.facebook.com/eff',instagram:'https://www.instagram.com/efforg',youtube:'https://www.youtube.com/user/eff'},'Protect civil liberties, privacy, and free expression in the digital world.','Cause: Surveillance and censorship threaten digital rights.\nResolution: Fund legal defense, tools, and advocacy.\nProof: Case filings and public advocacy reports.',500],
  ['Civic Tech','Creative Commons','Open Licensing for Shared Knowledge','Mountain View, CA, USA',37.3861,-122.0839,'https://creativecommons.org',{x:'https://x.com/creativecommons',facebook:'https://www.facebook.com/creativecommons',linkedin:'https://www.linkedin.com/company/creative-commons'},'Enable sharing of knowledge and culture through open licenses and tools.','Cause: Restrictive licensing limits access to knowledge.\nResolution: Support open licensing infrastructure and education.\nProof: License adoption and program reporting.',400],
  ['Civic Tech','Mozilla Foundation','Healthy, Open Internet for All','San Francisco, CA, USA',37.3875,-122.0575,'https://foundation.mozilla.org',{x:'https://x.com/mozilla',facebook:'https://www.facebook.com/mozilla',instagram:'https://www.instagram.com/mozilla'},'Advance a healthier internet through open technology and public-interest advocacy.','Cause: Centralized platforms threaten openness and privacy.\nResolution: Fund open internet initiatives and research.\nProof: Public reports and program outcomes.',500],
  ['Civic Tech','Internet Archive','Universal Access to Knowledge','San Francisco, CA, USA',37.7823,-122.4716,'https://archive.org',{x:'https://x.com/internetarchive',facebook:'https://www.facebook.com/internetnetarchive'},'Preserve digital culture and provide universal access to knowledge.','Cause: Digital history and resources disappear without preservation.\nResolution: Fund archiving and open access services.\nProof: Collection growth and access metrics.',500],

  // Classrooms / Education / Children
  ['Classrooms','UNICEF','Protect & Educate Children Worldwide','New York, NY, USA',40.7503,-73.9690,'https://www.unicef.org',{x:'https://x.com/UNICEF',facebook:'https://www.facebook.com/unicef',instagram:'https://www.instagram.com/unicef',youtube:'https://www.youtube.com/user/unicef'},'Deliver health, nutrition, education, and protection services for children.','Cause: Children face preventable disease, malnutrition, and lost schooling.\nResolution: Fund child health, education, and protection programs.\nProof: UNICEF program and results reporting.',750],
  ['Classrooms','Save the Children','Children’s Health, Education & Safety','Fairfield, CT, USA',41.1415,-73.2637,'https://www.savethechildren.org',{x:'https://x.com/SavetheChildren',facebook:'https://www.facebook.com/savethechildren',instagram:'https://www.instagram.com/savethechildren',youtube:'https://www.youtube.com/user/savethechildren'},'Give children a healthy start, the opportunity to learn, and protection from harm.','Cause: Poverty and crisis disrupt children’s health and learning.\nResolution: Fund education, health, and protection programs.\nProof: Program outcome reports.',600],
  ['Classrooms','Plan International','Advance Children’s Rights & Equality','Woking, United Kingdom',51.3168,-0.5600,'https://plan-international.org',{x:'https://x.com/PlanGlobal',facebook:'https://www.facebook.com/planinternational',instagram:'https://www.instagram.com/planinternational',linkedin:'https://www.linkedin.com/company/plan-international'},'Support girls’ education and children’s rights in vulnerable communities.','Cause: Inequality blocks education and safety for children.\nResolution: Fund education and protection initiatives.\nProof: Program monitoring and reports.',500],
  ['Classrooms','Education Cannot Wait','Education in Emergencies for Children','New York, NY, USA',40.7489,-73.9680,'https://www.educationcannotwait.org',{x:'https://x.com/EduCannotWait',facebook:'https://www.facebook.com/EducationCannotWait',linkedin:'https://www.linkedin.com/company/education-cannot-wait'},'Deliver safe, quality education to children affected by crises.','Cause: Emergencies disrupt schooling for millions of children.\nResolution: Fund rapid and sustained education responses.\nProof: Response reports and learning outcomes.',600],
  ['Classrooms','Pratham','Improve Foundational Learning','Mumbai, India',19.0760,72.8777,'https://www.pratham.org',{x:'https://x.com/Pratham_India',facebook:'https://www.facebook.com/PrathamEducationFoundation',instagram:'https://www.instagram.com/pratham_education',linkedin:'https://www.linkedin.com/company/pratham-education-foundation'},'Strengthen foundational literacy and numeracy for children at scale.','Cause: Many children lack basic reading and math skills.\nResolution: Fund evidence-based learning programs.\nProof: Learning assessment and program data.',500],
  ['Classrooms','SOS Children’s Villages','Family Care for Children Without Parental Care','Innsbruck, Austria',47.2692,11.4041,'https://www.sos-childrensvillages.org',{x:'https://x.com/sos_children',facebook:'https://www.facebook.com/soschildrensvillages',instagram:'https://www.instagram.com/sos_childrens_villages',linkedin:'https://www.linkedin.com/company/sos-children-s-villages-international'},'Provide stable family-like care and support for children without adequate parental care.','Cause: Children without care lack stability and support.\nResolution: Fund family-based care and youth support.\nProof: Care and program reports.',500],

  // Health access & humanitarian (mapped to valid categories)
  ['Accessibility & Universal Design','Médecins Sans Frontières (MSF)','Emergency Medical Care Where Needed Most','Geneva, Switzerland',46.2208,6.1431,'https://www.msf.org',{x:'https://x.com/MSF',facebook:'https://www.facebook.com/msf.english',instagram:'https://www.instagram.com/doctorswithoutborders',youtube:'https://www.youtube.com/user/msf'},'Deliver independent emergency medical care in crises and underserved areas.','Cause: Conflict and disaster leave people without medical care.\nResolution: Fund emergency medical teams and supplies.\nProof: Field activity and medical reporting.',750],
  ['Civic Tech','International Committee of the Red Cross (ICRC)','Protect & Assist Victims of Conflict','Geneva, Switzerland',46.2276,6.1370,'https://www.icrc.org',{x:'https://x.com/ICRC',facebook:'https://www.facebook.com/icrc',instagram:'https://www.instagram.com/icrc',linkedin:'https://www.linkedin.com/company/icrc'},'Provide humanitarian protection and assistance for people affected by armed conflict.','Cause: Conflict harms civilians and disrupts essential services.\nResolution: Fund protection, health, and relief operations.\nProof: Operational and accountability reports.',750],
  ['Accessibility & Universal Design','Partners In Health','High-Quality Care for the Poor','Boston, MA, USA',42.3601,-71.0589,'https://www.pih.org',{x:'https://x.com/PIH',facebook:'https://www.facebook.com/partnersinhealth',instagram:'https://www.instagram.com/partnersinhealth',youtube:'https://www.youtube.com/user/partnersinhealth'},'Strengthen health systems and deliver care in impoverished communities.','Cause: Poverty blocks access to quality healthcare.\nResolution: Fund clinics, staff, and community health programs.\nProof: Clinical and program reports.',600],
  ['Classrooms','Gavi, the Vaccine Alliance','Expand Equitable Immunization for Children','Geneva, Switzerland',46.2205,6.1390,'https://www.gavi.org',{x:'https://x.com/gavi',facebook:'https://www.facebook.com/gavi',linkedin:'https://www.linkedin.com/company/gavi'},'Increase access to lifesaving vaccines for children in lower-income countries.','Cause: Vaccine gaps leave children vulnerable to preventable disease.\nResolution: Fund immunization programs and supply chains.\nProof: Coverage data and program reports.',700],
  ['Accessibility & Universal Design','The Global Fund','Fight AIDS, Tuberculosis & Malaria','Geneva, Switzerland',46.2296,6.1187,'https://www.theglobalfund.org',{x:'https://x.com/globalfund',facebook:'https://www.facebook.com/theglobalfund',instagram:'https://www.instagram.com/globalfund',linkedin:'https://www.linkedin.com/company/the-global-fund'},'Invest in programs to end AIDS, tuberculosis, and malaria as public health threats.','Cause: Infectious diseases continue to cause preventable deaths.\nResolution: Fund prevention, testing, and treatment programs.\nProof: Results and audit reporting.',700],
  ['Accessibility & Universal Design','Against Malaria Foundation','Provide Long-Lasting Insecticidal Nets','London, United Kingdom',51.5155,-0.1410,'https://www.againstmalaria.com',{x:'https://x.com/AgainstMalaria',facebook:'https://www.facebook.com/AgainstMalaria'},'Fund and distribute bed nets to prevent malaria in high-burden regions.','Cause: Malaria remains deadly without effective prevention.\nResolution: Purchase and distribute protective bed nets.\nProof: Distribution and monitoring reports.',500],
  ['Accessibility & Universal Design','Direct Relief','Deliver Medical Aid to People in Need','Santa Barbara, CA, USA',34.4208,-119.6982,'https://www.directrelief.org',{x:'https://x.com/DirectRelief',facebook:'https://www.facebook.com/directrelief',instagram:'https://www.instagram.com/directrelief',linkedin:'https://www.linkedin.com/company/direct-relief'},'Provide medicines and medical supplies to communities affected by poverty and emergencies.','Cause: Clinics and patients lack essential medicines and supplies.\nResolution: Fund procurement and delivery of medical aid.\nProof: Shipment and partner reports.',600],

  // Additional global (curated, public HQs)
  ['Environmental','Greenpeace International','Protect the Planet & Climate','Amsterdam, Netherlands',52.3676,4.9041,'https://www.greenpeace.org/international/',{x:'https://x.com/Greenpeace',facebook:'https://www.facebook.com/greenpeace.international',instagram:'https://www.instagram.com/greenpeace',youtube:'https://www.youtube.com/user/GreenpeaceVideo'},'Campaign for climate action, ocean protection, and a healthy environment.','Cause: Climate and pollution threaten ecosystems and communities.\nResolution: Fund environmental protection campaigns and research.\nProof: Campaign and impact reports.',500],
  ['Environmental','Rainforest Alliance','Protect Forests & Sustainable Livelihoods','New York, NY, USA',40.7506,-73.9935,'https://www.rainforest-alliance.org',{x:'https://x.com/RnfrstAlliance',facebook:'https://www.facebook.com/RainforestAlliance',instagram:'https://www.instagram.com/rainforestalliance',linkedin:'https://www.linkedin.com/company/rainforest-alliance'},'Conserve biodiversity and ensure sustainable livelihoods by transforming land-use practices.','Cause: Deforestation harms climate and communities.\nResolution: Fund forest conservation and sustainable farming programs.\nProof: Certification and field reports.',500],
  ['Environmental','Wildlife Conservation Society','Save Wildlife & Wild Places','Bronx, NY, USA',40.8506,-73.8769,'https://www.wcs.org',{x:'https://x.com/TheWCS',facebook:'https://www.facebook.com/TheWCS',instagram:'https://www.instagram.com/thewcs',youtube:'https://www.youtube.com/user/WCSMedia'},'Protect wildlife and wild places through science, conservation action, and education.','Cause: Species and habitats face escalating threats.\nResolution: Fund conservation programs in critical landscapes.\nProof: Conservation monitoring reports.',600],
  ['Civic Tech','Amnesty International','Defend Human Rights Worldwide','London, United Kingdom',51.4945,-0.1257,'https://www.amnesty.org',{x:'https://x.com/amnesty',facebook:'https://www.facebook.com/amnesty',instagram:'https://www.instagram.com/amnesty',youtube:'https://www.youtube.com/user/AmnestyInternational'},'Campaign to protect human rights and hold abusers accountable.','Cause: Rights violations occur without accountability.\nResolution: Fund research, advocacy, and support for rights defenders.\nProof: Research publications and campaign reports.',500],
  ['Civic Tech','Human Rights Watch','Investigate & Report on Rights Abuses','New York, NY, USA',40.7532,-73.9822,'https://www.hrw.org',{x:'https://x.com/hrw',facebook:'https://www.facebook.com/HumanRightsWatch',instagram:'https://www.instagram.com/humanrightswatch',youtube:'https://www.youtube.com/user/HumanRightsWatch'},'Investigate abuses and advocate for policies that protect human dignity.','Cause: Abuses persist when hidden or ignored.\nResolution: Fund investigations and advocacy.\nProof: Published investigations and advocacy outcomes.',500],
  ['Civic Tech','Transparency International','Fight Corruption Globally','Berlin, Germany',52.5200,13.4050,'https://www.transparency.org',{x:'https://x.com/anticorruption',facebook:'https://www.facebook.com/TransparencyInternational',linkedin:'https://www.linkedin.com/company/transparency-international'},'Promote transparency, accountability, and integrity in public life.','Cause: Corruption diverts resources from public good.\nResolution: Fund anti-corruption research and advocacy.\nProof: Indexes, reports, and program outcomes.',500],
  ['Classrooms','BRAC','Empower People & Communities Out of Poverty','Dhaka, Bangladesh',23.7806,90.4070,'https://www.brac.net',{x:'https://x.com/BRACWorld',facebook:'https://www.facebook.com/BRACWorld',linkedin:'https://www.linkedin.com/company/brac'},'Deliver education, health, and livelihoods programs to lift families out of poverty.','Cause: Poverty limits education and opportunity.\nResolution: Fund integrated development and education programs.\nProof: Program evaluations and reports.',600],
  ['Classrooms','CARE International','Fight Global Poverty & Support Women and Girls','Geneva, Switzerland',46.2230,6.1470,'https://www.care-international.org',{x:'https://x.com/CAREGlobal',facebook:'https://www.facebook.com/CARE',instagram:'https://www.instagram.com/careorg',linkedin:'https://www.linkedin.com/company/care'},'Save lives, defeat poverty, and achieve social justice with a focus on women and girls.','Cause: Inequality and crisis limit safety and opportunity.\nResolution: Fund humanitarian and development programs.\nProof: Program and impact reports.',600],
  ['Classrooms','Oxfam International','End the Injustice of Poverty','Nairobi, Kenya',-1.2921,36.8219,'https://www.oxfam.org',{x:'https://x.com/Oxfam',facebook:'https://www.facebook.com/oxfam',instagram:'https://www.instagram.com/oxfaminternational',youtube:'https://www.youtube.com/user/oxfam'},'Tackle the root causes of poverty and injustice worldwide.','Cause: Inequality and crisis drive poverty.\nResolution: Fund relief, development, and advocacy programs.\nProof: Program and accountability reports.',600],
  ['Accessibility & Universal Design','International Rescue Committee (IRC)','Help People Survive Conflict & Disaster','New York, NY, USA',40.7484,-73.9857,'https://www.rescue.org',{x:'https://x.com/RESCUEorg',facebook:'https://www.facebook.com/InternationalRescueCommittee',instagram:'https://www.instagram.com/rescueorg',youtube:'https://www.youtube.com/user/InternationalRescue'},'Provide emergency aid and long-term support to refugees and displaced families.','Cause: Displacement strips families of safety and services.\nResolution: Fund health, education, and resettlement support.\nProof: Program delivery and outcome reports.',700],
  ['Accessibility & Universal Design','Operation Smile','Free Cleft Surgery & Comprehensive Care','Virginia Beach, VA, USA',36.8529,-75.9780,'https://www.operationsmile.org',{x:'https://x.com/operationsmile',facebook:'https://www.facebook.com/operationsmile',instagram:'https://www.instagram.com/operationsmile',youtube:'https://www.youtube.com/user/operationsmile'},'Provide free cleft lip and palate surgeries and follow-up care for children.','Cause: Children lack access to safe cleft surgery.\nResolution: Fund surgical missions and comprehensive care.\nProof: Surgical and patient outcome records.',500],
  ['Environmental','Environmental Defense Fund (EDF)','Solutions for Climate & Environment','New York, NY, USA',40.7069,-74.0113,'https://www.edf.org',{x:'https://x.com/EnvDefenseFund',facebook:'https://www.facebook.com/EnvDefenseFund',instagram:'https://www.instagram.com/environmental_defense_fund',linkedin:'https://www.linkedin.com/company/environmental-defense-fund'},'Create practical solutions to stabilize the climate and protect nature.','Cause: Climate change and pollution threaten communities.\nResolution: Fund science-based environmental solutions.\nProof: Program and impact reports.',500],
  ['Classrooms','Teach For All','Expand Educational Opportunity','New York, NY, USA',40.7411,-73.9897,'https://teachforall.org',{x:'https://x.com/TeachForAll',facebook:'https://www.facebook.com/TeachForAll',linkedin:'https://www.linkedin.com/company/teach-for-all'},'Develop collective leadership to ensure all children can fulfill their potential.','Cause: Educational inequity limits children’s futures.\nResolution: Support teacher leadership and learning initiatives.\nProof: Network and program reports.',500],
  ['Accessibility & Universal Design','Lions Clubs International Foundation','Vision, Youth, Disaster Relief & Humanitarian Aid','Oak Brook, IL, USA',41.8390,-87.9536,'https://www.lionsclubs.org/en/lcif',{x:'https://x.com/lionsclubs',facebook:'https://www.facebook.com/lionsclubs',instagram:'https://www.instagram.com/lionsclubs'},'Support sight programs, disaster relief, and community humanitarian projects worldwide.','Cause: Communities lack resources for vision care and disaster response.\nResolution: Fund vision, relief, and community service grants.\nProof: Grant and program reporting.',500]
];

function main() {
  let raw = fs.readFileSync(FEED_PATH, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const feed = JSON.parse(raw);

  // Build master list entries
  const master = GLOBAL.map(g => block(g[0], g[1], g[2], g[3], g[4], g[5], g[6], g[7], g[8], g[9], g[10]));

  // Ensure all existing items have website/socials fields and enrich known orgs
  const KNOWN = {
    'Perkins School for the Blind': { website: 'https://www.perkins.org', socials: { x: 'https://x.com/PerkinsVision', facebook: 'https://www.facebook.com/PerkinsSchoolfortheBlind', instagram: 'https://www.instagram.com/perkinsvision', linkedin: 'https://www.linkedin.com/school/perkins-school-for-the-blind/' } },
    'GiveDirectly': { website: 'https://www.givedirectly.org', socials: { x: 'https://x.com/GiveDirectly', facebook: 'https://www.facebook.com/givedirectly', instagram: 'https://www.instagram.com/givedirectly', linkedin: 'https://www.linkedin.com/company/givedirectly' } },
    'The Water Project': { website: 'https://thewaterproject.org', socials: { x: 'https://x.com/TheWaterProject', facebook: 'https://www.facebook.com/thewaterproject', instagram: 'https://www.instagram.com/thewaterproject' } },
    'World Central Kitchen': { website: 'https://wck.org', socials: { x: 'https://x.com/WCKitchen', facebook: 'https://www.facebook.com/WorldCentralKitchen', instagram: 'https://www.instagram.com/wckitchen' } },
    'The Tor Project': { website: 'https://www.torproject.org', socials: { x: 'https://x.com/torproject' } },
    'DonorsChoose': { website: 'https://www.donorschoose.org', socials: { x: 'https://x.com/DonorsChoose', facebook: 'https://www.facebook.com/DonorsChoose', instagram: 'https://www.instagram.com/donorschoose' } },
    'Room to Read': { website: 'https://www.roomtoread.org', socials: { x: 'https://x.com/RoomtoRead', facebook: 'https://www.facebook.com/roomtoread', instagram: 'https://www.instagram.com/roomtoread', linkedin: 'https://www.linkedin.com/company/room-to-read' } },
    'Habitat for Humanity': { website: 'https://www.habitat.org', socials: { x: 'https://x.com/Habitat_org', facebook: 'https://www.facebook.com/habitat', instagram: 'https://www.instagram.com/habitatforhumanity' } },
    'Fisher House Foundation': { website: 'https://fisherhouse.org', socials: { x: 'https://x.com/FisherHouseFdtn', facebook: 'https://www.facebook.com/FisherHouseFoundation', instagram: 'https://www.instagram.com/fisherhousefoundation' } },
    'Gary Sinise Foundation (R.I.S.E.)': { website: 'https://www.garysinisefoundation.org', socials: { x: 'https://x.com/GarySiniseFound', facebook: 'https://www.facebook.com/GarySiniseFoundation', instagram: 'https://www.instagram.com/garysinisefoundation' } },
    'KABOOM!': { website: 'https://kaboom.org', socials: { x: 'https://x.com/kaboom', facebook: 'https://www.facebook.com/kaboom', instagram: 'https://www.instagram.com/kaboom' } },
    'Smile Train': { website: 'https://www.smiletrain.org', socials: { x: 'https://x.com/SmileTrain', facebook: 'https://www.facebook.com/SmileTrain', instagram: 'https://www.instagram.com/smiletrain' } },
    'Meals on Wheels America': { website: 'https://www.mealsonwheelsamerica.org', socials: { x: 'https://x.com/_MealsOnWheels', facebook: 'https://www.facebook.com/MealsonWheelsAmerica', instagram: 'https://www.instagram.com/mealsonwheelsamerica' } },
    'Kiva': { website: 'https://www.kiva.org', socials: { x: 'https://x.com/Kiva', facebook: 'https://www.facebook.com/kiva', instagram: 'https://www.instagram.com/kiva' } },
    'Best Friends Animal Society': { website: 'https://bestfriends.org', socials: { x: 'https://x.com/bestfriends', facebook: 'https://www.facebook.com/bestfriendsanimalsociety', instagram: 'https://www.instagram.com/bestfriendsanimalsociety' } },
    'Guiding Eyes for the Blind': { website: 'https://www.guidingeyes.org', socials: { x: 'https://x.com/GuidingEyes', facebook: 'https://www.facebook.com/GuidingEyesfortheBlind', instagram: 'https://www.instagram.com/guidingeyes' } },
    'National Park Foundation': { website: 'https://www.nationalparks.org', socials: { x: 'https://x.com/GoParks', facebook: 'https://www.facebook.com/nationalparkfoundation', instagram: 'https://www.instagram.com/goparks' } },
    'Easterseals': { website: 'https://www.easterseals.com', socials: { x: 'https://x.com/Easterseals', facebook: 'https://www.facebook.com/easterseals', instagram: 'https://www.instagram.com/easterseals' } },
    'Special Olympics': { website: 'https://www.specialolympics.org', socials: { x: 'https://x.com/SpecialOlympics', facebook: 'https://www.facebook.com/SpecialOlympics', instagram: 'https://www.instagram.com/specialolympics' } },
    'St. Jude Children\'s Research Hospital': { website: 'https://www.stjude.org', socials: { x: 'https://x.com/StJude', facebook: 'https://www.facebook.com/stjude', instagram: 'https://www.instagram.com/stjude' } },
    'Ronald McDonald House Charities': { website: 'https://rmhc.org', socials: { x: 'https://x.com/RMHC', facebook: 'https://www.facebook.com/RMHC', instagram: 'https://www.instagram.com/rmhc' } },
    'Canine Companions': { website: 'https://canine.org', socials: { x: 'https://x.com/CanineCompanion', facebook: 'https://www.facebook.com/CanineCompanions', instagram: 'https://www.instagram.com/caninecompanions' } },
    'Guide Dogs for the Blind (GDB)': { website: 'https://www.guidedogs.com', socials: { x: 'https://x.com/guidedogs', facebook: 'https://www.facebook.com/guidedogsfortheblind', instagram: 'https://www.instagram.com/guidedogsfortheblind' } },
    'Shriners Children\'s': { website: 'https://www.shrinerschildrens.org', socials: { x: 'https://x.com/shrinershosp', facebook: 'https://www.facebook.com/ShrinersChildrens', instagram: 'https://www.instagram.com/shrinerschildrens' } },
    'Best Buddies International': { website: 'https://www.bestbuddies.org', socials: { x: 'https://x.com/bestbuddies', facebook: 'https://www.facebook.com/bestbuddies', instagram: 'https://www.instagram.com/bestbuddies' } },
    'United Cerebral Palsy (UCP)': { website: 'https://ucp.org', socials: { x: 'https://x.com/UCPnational', facebook: 'https://www.facebook.com/unitedcerebralpalsy' } },
    'Child Mind Institute': { website: 'https://childmind.org', socials: { x: 'https://x.com/ChildMindInst', facebook: 'https://www.facebook.com/ChildMindInstitute', instagram: 'https://www.instagram.com/childmindinstitute' } },
    'The Hole in the Wall Gang Camp': { website: 'https://www.holeinthewallgang.org', socials: { x: 'https://x.com/HitWGC', facebook: 'https://www.facebook.com/holeinthewallgangcamp', instagram: 'https://www.instagram.com/holeinthewallgangcamp' } },
    'Wheelchairs 4 Kids': { website: 'https://wheelchairs4kids.org', socials: { x: 'https://x.com/wheelchairs4kid', facebook: 'https://www.facebook.com/wheelchairs4kids' } },
    'Friends of Disabled Adults and Children (FODAC)': { website: 'https://fodac.org', socials: { facebook: 'https://www.facebook.com/FODAC' } },
    'Challenged Athletes Foundation (CAF)': { website: 'https://www.challengedathletes.org', socials: { x: 'https://x.com/CAFoundation', facebook: 'https://www.facebook.com/ChallengedAthletesFoundation', instagram: 'https://www.instagram.com/cafoundation' } },
    'Variety – the Children\'s Charity': { website: 'https://variety.org', socials: { x: 'https://x.com/VarietyIntl', facebook: 'https://www.facebook.com/VarietytheChildrensCharity' } },
    'Little Free Library': { website: 'https://littlefreelibrary.org', socials: { x: 'https://x.com/LtlFreeLibrary', facebook: 'https://www.facebook.com/LittleFreeLibrary', instagram: 'https://www.instagram.com/littlefreelibrary' } },
    'First Book': { website: 'https://firstbook.org', socials: { x: 'https://x.com/FirstBook', facebook: 'https://www.facebook.com/FirstBook', instagram: 'https://www.instagram.com/firstbook' } },
    'Reading Is Fundamental (RIF)': { website: 'https://www.rif.org', socials: { x: 'https://x.com/RIFWEB', facebook: 'https://www.facebook.com/ReadingIsFundamental', instagram: 'https://www.instagram.com/rifweb' } },
    'Books for Africa': { website: 'https://www.booksforafrica.org', socials: { x: 'https://x.com/BooksForAfrica', facebook: 'https://www.facebook.com/BooksForAfrica' } },
    'Marine Toys for Tots Foundation': { website: 'https://www.toysfortots.org', socials: { facebook: 'https://www.facebook.com/toysfortots' } },
    'The Dollywood Foundation': { website: 'https://imaginationlibrary.com', socials: { facebook: 'https://www.facebook.com/dollysimaginationlibrary' } },
    'Modest Needs': { website: 'https://www.modestneeds.org', socials: { x: 'https://x.com/ModestNeeds', facebook: 'https://www.facebook.com/ModestNeeds' } },
    'National Center for Learning Disabilities': { website: 'https://www.ncld.org', socials: { x: 'https://x.com/NCLDorg', facebook: 'https://www.facebook.com/NCLDorg' } }
  };
  for (const it of feed.items) {
    const m = it._polytab || (it._polytab = {});
    if (m.website === undefined) m.website = null;
    if (m.socials === undefined || typeof m.socials !== 'object' || Array.isArray(m.socials)) m.socials = {};
    const org = (m.organization || '').trim();
    const known = KNOWN[org];
    if (known) {
      if (!m.website && known.website) m.website = known.website;
      if (known.socials) m.socials = Object.assign({}, known.socials, m.socials || {});
    }
  }

  // Merge master: skip if same org+title already present
  const existingKeys = new Set(feed.items.map(it => ((it._polytab && it._polytab.organization) || '') + '|' + (it.title || '')));
  let added = 0;
  for (const it of master) {
    const key = (it._polytab.organization || '') + '|' + (it.title || '');
    if (existingKeys.has(key)) continue;
    feed.items.push(it);
    existingKeys.add(key);
    added++;
  }

  // Write master dataset (standalone list)
  const masterDoc = {
    version: 1,
    updated_at: new Date().toISOString(),
    description: 'Polytab global charity master list (curated). Public organizations with public HQ locations, official websites, and social links. All entries honest-zero (fundedUSD=0, votesCount=0). No coordinates near private residences; HQ/public locations only.',
    id_compartmentalization: {
      note: 'Numeric IDs are compartmentalized by site-valid category blocks for structure and wallet compatibility.',
      blocks: {
        'Accessibility & Universal Design': '10001-19999',
        'Environmental': '20001-29999',
        'Civic Tech': '30001-39999',
        'Classrooms': '40001-49999',
        'Arts & Clubs': '45001-49999',
        'Campus Grounds': '60001-69999',
        'Athletics': '70001-79999'
      }
    },
    items: master
  };

  fs.mkdirSync(path.dirname(OUT_MASTER), { recursive: true });
  fs.writeFileSync(OUT_MASTER, JSON.stringify(masterDoc, null, 2) + '\n', 'utf8');
  fs.writeFileSync(FEED_PATH, JSON.stringify(feed, null, 2) + '\n', 'utf8');

  console.log('master_created=' + master.length + ' added_to_feed=' + added + ' feed_total=' + feed.items.length);
}

main();
