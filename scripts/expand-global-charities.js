const fs = require('fs');
const path = require('path');

const FEED_PATH = 'X:\\PolyTabRepo\\docs\\feed.json';
const OUT_MASTER = 'X:\\PolyTabRepo\\docs\\data\\global-charities.json';

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

// All unclaimed bounties route to the placeholder wallet (page ships donation-locked)
const ESCROW_WALLET = '0x1e89ff2c2922528c8AcE8dB07F73ef979Ea76C08';
function walletFor(_id) { return ESCROW_WALLET; }

function safeUrl(u){ return (typeof u==='string' && /^https?:\/\//i.test(u.trim())) ? u.trim() : null; }

function block(category, org, title, location, lat, lng, website, socials, summary, plainSummary, targetUSD) {
  const cat = VALID_CATEGORIES.has(category) ? category : 'Civic Tech';
  const idNum = nextId(cat);
  const id = String(idNum);
  const soc = {};
  if (socials && typeof socials==='object') {
    for (const [k,v] of Object.entries(socials)) { const sv=safeUrl(v); if (sv) soc[k]=sv; }
  }
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
      website: safeUrl(website),
      socials: soc
    }
  };
}

const counters = {};
function nextId(category) {
  const base = CAT_BLOCK[category] || 80000;
  counters[base] = (counters[base] || 0) + 1;
  return base + counters[base];
}

// Large curated set: real public organizations, public HQ coords, official websites/socials.
// All honest-zero. No coords near private residences.
const MORE = [
  // Accessibility & Universal Design / Health access
  ['Accessibility & Universal Design','American Red Cross','Disaster Relief & Emergency Health Services','Washington, DC, USA',38.8949,-77.0407,'https://www.redcross.org',{x:'https://x.com/RedCross',facebook:'https://www.facebook.com/redcross',instagram:'https://www.instagram.com/americanredcross'},'Provide emergency assistance, disaster relief, and health services.','Cause: Disasters and emergencies disrupt safety and health.\nResolution: Fund relief supplies, shelters, and health services.\nProof: Disaster response and program reports.',750],
  ['Accessibility & Universal Design','International Federation of Red Cross and Red Crescent Societies (IFRC)','Global Humanitarian Relief & Health','Geneva, Switzerland',46.2207,6.1369,'https://www.ifrc.org',{x:'https://x.com/IFRC',facebook:'https://www.facebook.com/IFRC',instagram:'https://www.instagram.com/ifrc'},'Coordinate humanitarian aid and health support through Red Cross and Red Crescent societies.','Cause: Crises overwhelm local response capacity.\nResolution: Fund coordinated relief and health programs.\nProof: IFRC operations and accountability reports.',750],
  ['Accessibility & Universal Design','Project HOPE','Global Health & Humanitarian Assistance','Bethesda, MD, USA',38.9807,-77.1003,'https://www.projecthope.org',{x:'https://x.com/projecthopeorg',facebook:'https://www.facebook.com/projecthopeorg',instagram:'https://www.instagram.com/projecthopeorg',linkedin:'https://www.linkedin.com/company/project-hope'},'Deliver health training, humanitarian aid, and community health programs worldwide.','Cause: Communities lack access to skilled health care.\nResolution: Fund medical training and health services.\nProof: Program and clinical reports.',600],
  ['Accessibility & Universal Design','Mercy Ships','Free Surgical Care via Hospital Ships','Lindale, TX, USA',32.5157,-95.4094,'https://www.mercyships.org',{x:'https://x.com/MercyShips',facebook:'https://www.facebook.com/MercyShips',instagram:'https://www.instagram.com/mercyships'},'Provide free surgeries and medical training in underserved regions.','Cause: Lack of surgical care causes preventable suffering.\nResolution: Fund surgical missions and training.\nProof: Surgical outcomes and mission reports.',700],
  ['Accessibility & Universal Design','Orbis International','Fight Avoidable Blindness Worldwide','New York, NY, USA',40.7516,-73.9755,'https://www.orbis.org',{x:'https://x.com/OrbisIntl',facebook:'https://www.facebook.com/orbisinternational',instagram:'https://www.instagram.com/orbisintl'},'Prevent and treat avoidable blindness through training and care.','Cause: Avoidable blindness persists without access to eye care.\nResolution: Fund eye care, training, and sight-saving programs.\nProof: Clinical and program reports.',600],
  ['Accessibility & Universal Design','Helen Keller Intl','Prevent Blindness & Reduce Malnutrition','New York, NY, USA',40.7489,-73.9680,'https://helenkellerintl.org',{x:'https://x.com/HelenKellerIntl',facebook:'https://www.facebook.com/HelenKellerIntl',linkedin:'https://www.linkedin.com/company/helen-keller-international'},'Improve vision, health, and nutrition for vulnerable communities.','Cause: Preventable blindness and malnutrition harm families.\nResolution: Fund vision care and nutrition programs.\nProof: Program outcome reports.',500],
  ['Accessibility & Universal Design','Seva Foundation','Sustainable Eye Care Services','Berkeley, CA, USA',37.8715,-122.2730,'https://www.seva.org',{x:'https://x.com/seva_foundation',facebook:'https://www.facebook.com/SevaFoundation',instagram:'https://www.instagram.com/sevafoundation'},'Build sustainable eye care programs to restore sight.','Cause: Cataract and eye disease cause avoidable blindness.\nResolution: Fund eye clinics, surgeries, and training.\nProof: Service delivery and outcome reports.',500],
  ['Accessibility & Universal Design','Cure Blindness Project','Cataract Surgery & Eye Care Access','Burlington, VT, USA',44.4759,-73.2121,'https://cureblindness.org',{x:'https://x.com/cureblindness',facebook:'https://www.facebook.com/cureblindnessproject'},'Restore sight through high-quality, cost-effective cataract care.','Cause: Treatable cataracts cause needless blindness.\nResolution: Fund surgeries and local eye care capacity.\nProof: Surgical volume and outcome reporting.',500],
  ['Accessibility & Universal Design','MAP International','Medicines & Health Supplies for People in Need','Brunswick, GA, USA',31.1499,-81.4915,'https://www.map.org',{x:'https://x.com/MAPIntl',facebook:'https://www.facebook.com/mapintl',instagram:'https://www.instagram.com/mapintl'},'Provide essential medicines and health supplies to communities in need.','Cause: Clinics lack essential medicines and supplies.\nResolution: Fund procurement and distribution of medical aid.\nProof: Shipment and partner reports.',500],
  ['Accessibility & Universal Design','Americares','Health Programs & Emergency Medical Aid','Stamford, CT, USA',41.0534,-73.5387,'https://www.americares.org',{x:'https://x.com/americares',facebook:'https://www.facebook.com/americares',instagram:'https://www.instagram.com/americares'},'Provide medicines, supplies, and health programs for people affected by poverty or disaster.','Cause: Crises and poverty limit access to care.\nResolution: Fund medical aid and health programs.\nProof: Program and delivery reports.',600],
  ['Accessibility & Universal Design','International Medical Corps','Emergency Relief & Health Care Services','Los Angeles, CA, USA',34.0522,-118.2437,'https://internationalmedicalcorps.org',{x:'https://x.com/IMC_Worldwide',facebook:'https://www.facebook.com/internationalmedicalcorps',instagram:'https://www.instagram.com/internationalmedicalcorps'},'Deliver emergency health services and training in crisis-affected communities.','Cause: Emergencies disrupt essential health services.\nResolution: Fund medical response and training.\nProof: Field and program reports.',600],
  ['Accessibility & Universal Design','PATH','Global Health Innovation & Access','Seattle, WA, USA',47.6062,-122.3321,'https://www.path.org',{x:'https://x.com/PATHtweets',facebook:'https://www.facebook.com/PATHglobalhealth',linkedin:'https://www.linkedin.com/company/path'},'Advance health equity through innovation and stronger health systems.','Cause: Preventable disease persists where health systems are weak.\nResolution: Fund health solutions and system strengthening.\nProof: Program and impact reports.',600],
  ['Accessibility & Universal Design','Fistula Foundation','Life-Transforming Fistula Surgery','San Jose, CA, USA',37.3382,-121.8863,'https://fistulafoundation.org',{x:'https://x.com/Fistula_Fdtn',facebook:'https://www.facebook.com/fistulafoundation',instagram:'https://www.instagram.com/fistulafoundation'},'Fund treatment for obstetric fistula and restore health and dignity.','Cause: Obstetric fistula leaves women injured and isolated.\nResolution: Fund surgeries and care.\nProof: Treatment and outcome reporting.',500],
  ['Accessibility & Universal Design','Malaria Consortium','Prevent, Control & Treat Malaria and Other Diseases','London, United Kingdom',51.5142,-0.1040,'https://www.malariaconsortium.org',{x:'https://x.com/MalariaConsort',facebook:'https://www.facebook.com/MalariaConsortium',linkedin:'https://www.linkedin.com/company/malaria-consortium'},'Deliver evidence-based programs to prevent and treat malaria and other communicable diseases.','Cause: Preventable diseases harm children and families.\nResolution: Fund prevention and treatment programs.\nProof: Program coverage and outcome reports.',500],
  ['Accessibility & Universal Design','Evidence Action (Deworm the World)','Scale Evidence-Based Health Programs','Washington, DC, USA',38.9037,-77.0365,'https://www.evidenceaction.org',{x:'https://x.com/EvidenceAction',facebook:'https://www.facebook.com/EvidenceAction',linkedin:'https://www.linkedin.com/company/evidence-action'},'Scale programs with strong evidence to improve health and wellbeing.','Cause: Proven health interventions often fail to reach scale.\nResolution: Fund evidence-based deworming and health programs.\nProof: Monitoring and evaluation reports.',500],
  ['Accessibility & Universal Design','Vitamin Angels','Nutrition for Mothers and Children','Goleta, CA, USA',34.4358,-119.8276,'https://vitaminangels.org',{x:'https://x.com/vitaminangels',facebook:'https://www.facebook.com/vitaminangels',instagram:'https://www.instagram.com/vitaminangels'},'Provide lifesaving vitamins and nutrition support to underserved mothers and children.','Cause: Malnutrition threatens maternal and child health.\nResolution: Fund vitamin distribution and nutrition programs.\nProof: Distribution and program reports.',500],
  ['Accessibility & Universal Design','Living Goods','Community Health Workers Saving Lives','San Francisco, CA, USA',37.7897,-122.3972,'https://livinggoods.org',{x:'https://x.com/LivingGoods',facebook:'https://www.facebook.com/LivingGoods',linkedin:'https://www.linkedin.com/company/living-goods'},'Support digitally enabled community health workers to deliver care.','Cause: Families lack access to basic primary care.\nResolution: Fund community health worker programs.\nProof: Health outcome and program reports.',500],
  ['Accessibility & Universal Design','Last Mile Health','Community Health Systems in Remote Areas','Boston, MA, USA',42.3505,-71.0763,'https://lastmilehealth.org',{x:'https://x.com/LastMileHealth',facebook:'https://www.facebook.com/LastMileHealth',instagram:'https://www.instagram.com/lastmilehealth'},'Train and support community health workers in remote communities.','Cause: Remote communities lack reliable primary care.\nResolution: Fund community health worker training and support.\nProof: Program and outcome reports.',500],

  // Environmental
  ['Environmental','Sierra Club Foundation','Promote Climate Solutions & Conservation','Oakland, CA, USA',37.8044,-122.2712,'https://www.sierraclubfoundation.org',{x:'https://x.com/SierraClubFdn',facebook:'https://www.facebook.com/SierraClubFoundation'},'Support efforts to educate and empower people to protect the environment.','Cause: Climate and environmental threats require collective action.\nResolution: Fund conservation and climate initiatives.\nProof: Grant and program reports.',500],
  ['Environmental','Natural Resources Defense Council (NRDC)','Protect the Earth’s People, Plants, Animals & Systems','New York, NY, USA',40.7500,-73.9933,'https://www.nrdc.org',{x:'https://x.com/NRDC',facebook:'https://www.facebook.com/nrdc.org',instagram:'https://www.instagram.com/nrdc_org'},'Safeguard the earth through science, policy, and advocacy.','Cause: Pollution and climate change harm health and ecosystems.\nResolution: Fund environmental advocacy and solutions.\nProof: Advocacy and impact reports.',500],
  ['Environmental','350.org','Build a Global Climate Movement','Boston, MA, USA',42.3601,-71.0589,'https://350.org',{x:'https://x.com/350',facebook:'https://www.facebook.com/350.org',instagram:'https://www.instagram.com/350org'},'Organize grassroots action to address the climate crisis.','Cause: Climate change accelerates without collective action.\nResolution: Fund climate organizing and campaigns.\nProof: Campaign and program reports.',400],
  ['Environmental','Earthjustice','Environmental Law & Justice','San Francisco, CA, USA',37.7898,-122.3942,'https://earthjustice.org',{x:'https://x.com/Earthjustice',facebook:'https://www.facebook.com/Earthjustice',instagram:'https://www.instagram.com/earthjustice'},'Use the power of law to protect people’s health and the environment.','Cause: Environmental harms often go unchallenged.\nResolution: Fund legal advocacy for environmental protection.\nProof: Case filings and outcomes.',500],
  ['Environmental','The Ocean Cleanup','Remove Plastic from Oceans and Rivers','Rotterdam, Netherlands',51.9244,4.4777,'https://theoceancleanup.com',{x:'https://x.com/TheOceanCleanup',facebook:'https://www.facebook.com/TheOceanCleanup',instagram:'https://www.instagram.com/theoceancleanup'},'Develop and scale technologies to rid oceans and rivers of plastic.','Cause: Plastic pollution accumulates in waterways and oceans.\nResolution: Fund cleanup and interception deployments.\nProof: Extraction and monitoring data.',600],
  ['Environmental','WildAid','End Illegal Wildlife Trade','San Francisco, CA, USA',37.7955,-122.3937,'https://wildaid.org',{x:'https://x.com/WildAid',facebook:'https://www.facebook.com/WildAid',instagram:'https://www.instagram.com/wildaid'},'Reduce demand for illegal wildlife products through awareness and partnerships.','Cause: Illegal wildlife trade threatens species survival.\nResolution: Fund demand-reduction and protection campaigns.\nProof: Campaign and program reports.',500],
  ['Environmental','African Wildlife Foundation','Protect Africa’s Wildlife and Wild Lands','Washington, DC, USA',38.9050,-77.0410,'https://www.awf.org',{x:'https://x.com/AWF_Official',facebook:'https://www.facebook.com/AfricanWildlifeFoundation',instagram:'https://www.instagram.com/awf_official'},'Conserve wildlife and wild lands across Africa.','Cause: Habitat loss and poaching threaten wildlife.\nResolution: Fund conservation and community programs.\nProof: Conservation monitoring reports.',500],
  ['Environmental','Jane Goodall Institute','Wildlife Research, Conservation & Education','Vienna, VA, USA',38.9012,-77.2653,'https://janegoodall.org',{x:'https://x.com/janegoodallinst',facebook:'https://www.facebook.com/janegoodallinstitute',instagram:'https://www.instagram.com/janegoodallinst'},'Protect chimpanzees and inspire conservation through community-centered programs.','Cause: Habitat loss and exploitation threaten primates and ecosystems.\nResolution: Fund conservation, research, and education.\nProof: Program and research reports.',500],
  ['Environmental','World Resources Institute (WRI)','Research & Solutions for People and Planet','Washington, DC, USA',38.9027,-77.0375,'https://www.wri.org',{x:'https://x.com/WorldResources',facebook:'https://www.facebook.com/worldresources',linkedin:'https://www.linkedin.com/company/world-resources-institute'},'Deliver research and practical solutions for climate, energy, food, forests, water, and cities.','Cause: Sustainability challenges require data-driven solutions.\nResolution: Fund research and implementation partnerships.\nProof: Publications and program outcomes.',500],
  ['Environmental','Clean Air Task Force','Reduce Climate Pollution','Boston, MA, USA',42.3554,-71.0605,'https://www.catf.us',{x:'https://x.com/CleanAirTask',facebook:'https://www.facebook.com/CleanAirTaskForce',linkedin:'https://www.linkedin.com/company/clean-air-task-force'},'Push for technologies and policies needed to achieve a zero-emissions future.','Cause: Climate pollution continues at harmful levels.\nResolution: Fund policy and technology advocacy.\nProof: Policy and impact reports.',500],
  ['Environmental','Trees for the Future','Restore Land & Plant Trees with Farmers','Silver Spring, MD, USA',38.9907,-77.0261,'https://trees.org',{x:'https://x.com/Treesftf',facebook:'https://www.facebook.com/TreesfortheFuture',instagram:'https://www.instagram.com/treesforthefuture'},'Train farmers in agroforestry to restore degraded lands.','Cause: Land degradation harms food security and ecosystems.\nResolution: Fund tree planting and farmer training.\nProof: Planting and program reports.',500],
  ['Environmental','Eden: People+Planet (Eden Reforestation Projects)','Restore Forests & Alleviate Poverty','Glendora, CA, USA',34.1361,-117.8653,'https://www.eden-plus.org',{facebook:'https://www.facebook.com/edenreforestation'},'Support community-based forest restoration and livelihoods.','Cause: Deforestation degrades ecosystems and incomes.\nResolution: Fund restoration and community employment.\nProof: Restoration and monitoring reports.',500],
  ['Environmental','BirdLife International','Conserve Birds, Habitats & Global Biodiversity','Cambridge, United Kingdom',52.2053,0.1218,'https://www.birdlife.org',{x:'https://x.com/BirdLife_Intl',facebook:'https://www.facebook.com/BirdLifeInternational',instagram:'https://www.instagram.com/birdlife_international'},'Protect birds and the habitats they depend on worldwide.','Cause: Habitat loss threatens bird species and biodiversity.\nResolution: Fund habitat conservation and monitoring.\nProof: Conservation reports and species data.',500],
  ['Environmental','Wetlands International','Restore and Conserve Wetlands','Ede, Netherlands',52.0402,5.6649,'https://www.wetlands.org',{x:'https://x.com/WetlandsInt',facebook:'https://www.facebook.com/WetlandsInternational',linkedin:'https://www.linkedin.com/company/wetlands-international'},'Safeguard and restore wetlands for people and nature.','Cause: Wetland loss harms biodiversity and climate resilience.\nResolution: Fund wetland restoration and protection.\nProof: Restoration and program reports.',500],

  // Civic Tech / Rights / Knowledge
  ['Civic Tech','OpenStreetMap Foundation','Support Open, Editable Map Data','Cambridge, United Kingdom',52.2053,0.1218,'https://osmfoundation.org',{x:'https://x.com/openstreetmap'},'Sustain the infrastructure for open, collaborative mapping.','Cause: Access to open geographic data is uneven.\nResolution: Support open mapping infrastructure and community.\nProof: Public platform and reports.',400],
  ['Civic Tech','Code for America','Improve Government Services with Technology','San Francisco, CA, USA',37.7749,-122.4194,'https://codeforamerica.org',{x:'https://x.com/codeforamerica',facebook:'https://www.facebook.com/codeforamerica',linkedin:'https://www.linkedin.com/company/code-for-america'},'Make government services simple, effective, and easy to use.','Cause: Critical public services can be hard to access.\nResolution: Fund civic technology and service delivery improvements.\nProof: Program outcomes and public tools.',500],
  ['Civic Tech','Reporters Without Borders (RSF)','Defend Press Freedom','Paris, France',48.8566,2.3522,'https://rsf.org/en',{x:'https://x.com/RSF_inter',facebook:'https://www.facebook.com/Reporterssansfrontieres',instagram:'https://www.instagram.com/reporters_sans_frontieres'},'Protect journalists and defend the right to information.','Cause: Press freedom faces threats and censorship.\nResolution: Fund advocacy, assistance, and monitoring.\nProof: Press freedom reports and actions.',500],
  ['Civic Tech','Committee to Protect Journalists (CPJ)','Defend Journalists Worldwide','New York, NY, USA',40.7128,-74.0060,'https://cpj.org',{x:'https://x.com/pressfreedom',facebook:'https://www.facebook.com/committeetoprotectjournalists',instagram:'https://www.instagram.com/committeetoprotectjournalists'},'Promote press freedom and defend the rights of journalists.','Cause: Journalists face violence, imprisonment, and censorship.\nResolution: Fund advocacy and journalist support.\nProof: Case reporting and advocacy outcomes.',500],
  ['Civic Tech','Access Now','Defend and Extend Digital Rights','New York, NY, USA',40.7306,-73.9352,'https://www.accessnow.org',{x:'https://x.com/accessnow',facebook:'https://www.facebook.com/accessnow',instagram:'https://www.instagram.com/accessnow'},'Defend and extend the digital rights of users at risk around the world.','Cause: Digital rights are threatened by censorship and surveillance.\nResolution: Fund advocacy and rapid response support.\nProof: Reports and rights defense actions.',500],
  ['Civic Tech','Freedom House','Expand and Defend Freedom Globally','Washington, DC, USA',38.9034,-77.0390,'https://freedomhouse.org',{x:'https://x.com/freedomhouse',facebook:'https://www.facebook.com/FreedomHouse',linkedin:'https://www.linkedin.com/company/freedom-house'},'Research and advocacy for political rights and civil liberties.','Cause: Freedom and rights face global pressure.\nResolution: Fund research, advocacy, and support programs.\nProof: Research publications and program reports.',500],
  ['Civic Tech','Article 19','Defend Freedom of Expression','London, United Kingdom',51.5066,-0.0886,'https://www.article19.org',{x:'https://x.com/article19org',facebook:'https://www.facebook.com/ARTICLE19org'},'Work for a world where all people can freely express themselves.','Cause: Censorship and repression limit expression.\nResolution: Fund advocacy and legal support.\nProof: Reports and advocacy outcomes.',400],
  ['Civic Tech','International Refugee Assistance Project (IRAP)','Legal Aid for Displaced People','New York, NY, USA',40.7130,-74.0067,'https://refugeerights.org',{x:'https://x.com/RefugeeAssist',facebook:'https://www.facebook.com/RefugeeAssist',instagram:'https://www.instagram.com/refugeeassist'},'Provide legal advocacy and direct services for refugees and displaced people.','Cause: Displaced people face legal and protection barriers.\nResolution: Fund legal aid and advocacy.\nProof: Case outcomes and program reports.',500],
  ['Civic Tech','Civicus','Strengthen Citizen Action and Civil Society','Johannesburg, South Africa',-26.2041,28.0473,'https://www.civicus.org',{x:'https://x.com/CIVICUSalliance',facebook:'https://www.facebook.com/CIVICUS'},'Strengthen civil society and citizen participation worldwide.','Cause: Civic space is shrinking in many places.\nResolution: Fund civil society support and advocacy.\nProof: Monitoring and program reports.',500],
  ['Civic Tech','GlobalGiving','Connect Donors to Community-Led Projects','Washington, DC, USA',38.9072,-77.0369,'https://www.globalgiving.org',{x:'https://x.com/GlobalGiving',facebook:'https://www.facebook.com/GlobalGiving',instagram:'https://www.instagram.com/globalgiving'},'Support vetted community-led projects around the world.','Cause: Local projects struggle to access resources.\nResolution: Fund community-led initiatives via a vetted platform.\nProof: Project reporting and platform transparency.',500],

  // Classrooms / Education
  ['Classrooms','Khan Academy','Free, World-Class Education for Anyone','Mountain View, CA, USA',37.3861,-122.0839,'https://www.khanacademy.org',{x:'https://x.com/khanacademy',facebook:'https://www.facebook.com/khanacademy',instagram:'https://www.instagram.com/khanacademy',youtube:'https://www.youtube.com/khanacademy'},'Provide free online lessons and practice for learners everywhere.','Cause: Quality learning resources are not equally accessible.\nResolution: Fund free educational content and tools.\nProof: Platform usage and learning resources.',500],
  ['Classrooms','Malala Fund','Girls’ Education and Equality','Washington, DC, USA',38.9051,-77.0364,'https://malala.org',{x:'https://x.com/MalalaFund',facebook:'https://www.facebook.com/MalalaFund',instagram:'https://www.instagram.com/malalafund'},'Advocate for every girl’s right to 12 years of free, safe, quality education.','Cause: Many girls are denied access to education.\nResolution: Fund education advocacy and local champions.\nProof: Program and advocacy reports.',500],
  ['Classrooms','Camfed','Girls’ Education and Leadership in Africa','Cambridge, United Kingdom',52.2053,0.1218,'https://camfed.org',{x:'https://x.com/Camfed',facebook:'https://www.facebook.com/camfed',instagram:'https://www.instagram.com/camfed',linkedin:'https://www.linkedin.com/company/camfed'},'Support girls to learn, succeed, and lead change.','Cause: Poverty and inequality block girls’ education.\nResolution: Fund schooling support and leadership programs.\nProof: Education and alumnae outcomes.',600],
  ['Classrooms','Theirworld','End the Global Education Crisis','London, United Kingdom',51.5072,-0.1276,'https://theirworld.org',{x:'https://x.com/theirworld',facebook:'https://www.facebook.com/Theirworld',instagram:'https://www.instagram.com/theirworld'},'Campaign to give every child the best start in life and access to education.','Cause: Millions of children lack access to quality education.\nResolution: Fund education advocacy and projects.\nProof: Campaign and project reports.',500],
  ['Classrooms','Street Child','Education for Children in Low-Resource and Crisis Settings','London, United Kingdom',51.5074,-0.1278,'https://www.street-child.org',{x:'https://x.com/StreetChildUK',facebook:'https://www.facebook.com/streetchilduk',instagram:'https://www.instagram.com/streetchildunited'},'Help children access education in some of the world’s toughest environments.','Cause: Crisis and poverty keep children out of school.\nResolution: Fund schooling, protection, and family support.\nProof: Program and outcome reports.',500],
  ['Classrooms','buildOn','Build Schools and Mobilize Communities','Stamford, CT, USA',41.0534,-73.5387,'https://www.buildon.org',{x:'https://x.com/buildOnEmpowers',facebook:'https://www.facebook.com/buildOn',instagram:'https://www.instagram.com/buildon'},'Construct schools and run service-learning programs with communities.','Cause: Lack of school infrastructure limits learning.\nResolution: Fund school construction and education programs.\nProof: School construction and program reports.',500],
  ['Classrooms','Room to Grow','Support for Families and Early Childhood Development','New York, NY, USA',40.7580,-73.9855,'https://www.roomtogrow.org',{x:'https://x.com/RoomtoGrow_org',facebook:'https://www.facebook.com/RoomtoGrow',instagram:'https://www.instagram.com/roomtogrow_org'},'Provide resources and support for families raising babies in low-income circumstances.','Cause: Families lack resources for early childhood development.\nResolution: Fund coaching, materials, and family support.\nProof: Program participation and outcome reports.',400],
  ['Classrooms','Shine Literacy','Improve Literacy for Children','Cape Town, South Africa',-33.9249,18.4241,'https://www.shineliteracy.org.za',{facebook:'https://www.facebook.com/ShineLiteracy'},'Support children to become confident readers.','Cause: Many children struggle with foundational literacy.\nResolution: Fund literacy support programs.\nProof: Literacy assessment and program reports.',400],
  ['Classrooms','Libraries Without Borders','Access to Information, Education and Culture','Paris, France',48.8566,2.3522,'https://www.librarieswithoutborders.org',{x:'https://x.com/LibrariesWB',facebook:'https://www.facebook.com/librarieswithoutborders',instagram:'https://www.instagram.com/librarieswithoutborders'},'Expand access to information and education in vulnerable communities.','Cause: Information and learning resources are not equally accessible.\nResolution: Fund libraries, tools, and learning programs.\nProof: Program and access reports.',500],

  // Campus Grounds / Housing / Community
  ['Campus Grounds','ShelterBox','Emergency Shelter and Tools for Families','Truro, United Kingdom',50.2632,-5.0510,'https://shelterbox.org',{x:'https://x.com/ShelterBox',facebook:'https://www.facebook.com/ShelterBox',instagram:'https://www.instagram.com/shelterbox'},'Provide emergency shelter and essential items after disaster and conflict.','Cause: Disasters leave families without shelter.\nResolution: Fund shelter kits and deployment.\nProof: Deployment and aid reports.',600],
  ['Campus Grounds','All Hands and Hearts','Community-Inspired Disaster Relief and Rebuilding','Mattapoisett, MA, USA',41.6618,-70.8161,'https://www.allhandsandhearts.org',{x:'https://x.com/AllHandsHearts',facebook:'https://www.facebook.com/AllHandsAndHearts',instagram:'https://www.instagram.com/allhandsandhearts'},'Support disaster-affected communities through response and rebuilding.','Cause: Communities struggle to recover after disasters.\nResolution: Fund volunteer-led rebuilding and recovery.\nProof: Project completion and impact reports.',500],
  ['Campus Grounds','Team Rubicon','Disaster Response and Community Resilience','Los Angeles, CA, USA',34.0522,-118.2437,'https://teamrubiconusa.org',{x:'https://x.com/TeamRubicon',facebook:'https://www.facebook.com/teamrubicon',instagram:'https://www.instagram.com/teamrubicon'},'Mobilize veterans and volunteers to serve communities before, during, and after disasters.','Cause: Disasters strain local response and recovery.\nResolution: Fund disaster response and resilience operations.\nProof: Operations and impact reports.',500],
  ['Campus Grounds','Rebuilding Together','Safe and Healthy Housing Repairs','Washington, DC, USA',38.9072,-77.0369,'https://rebuildingtogether.org',{x:'https://x.com/RebldgTogthr',facebook:'https://www.facebook.com/RebuildingTogether',instagram:'https://www.instagram.com/rebuildingtogether'},'Repair homes and revitalize communities for neighbors in need.','Cause: Unsafe housing conditions harm health and stability.\nResolution: Fund critical home repairs and accessibility mods.\nProof: Project and outcome reports.',500],

  // Athletics / Inclusion
  ['Athletics','Right To Play','Play-Based Learning and Empowerment for Children','Toronto, Canada',43.6532,-79.3832,'https://righttoplay.com/en/',{x:'https://x.com/RightToPlayIntl',facebook:'https://www.facebook.com/righttoplay',instagram:'https://www.instagram.com/righttoplayintl'},'Protect, educate, and empower children through the power of play.','Cause: Conflict and poverty limit safe play and learning.\nResolution: Fund play-based education and inclusion programs.\nProof: Program monitoring and reports.',500],
  ['Athletics','PeacePlayers','Bridge Divides Through Sport and Leadership','Washington, DC, USA',38.9072,-77.0369,'https://peaceplayers.org',{x:'https://x.com/peaceplayersintl',facebook:'https://www.facebook.com/peaceplayersintl',instagram:'https://www.instagram.com/peaceplayersintl'},'Use sport to unite divided communities and develop youth leaders.','Cause: Division limits opportunity and cohesion for youth.\nResolution: Fund sport-for-peace and leadership programs.\nProof: Program participation and outcome reports.',400],
  ['Athletics','Special Olympics International','Sports, Inclusion and Health for People with Intellectual Disabilities','Washington, DC, USA',38.9047,-77.0340,'https://www.specialolympics.org',{x:'https://x.com/SpecialOlympics',facebook:'https://www.facebook.com/SpecialOlympics',instagram:'https://www.instagram.com/specialolympics'},'Provide year-round sports training and competitions for people with intellectual disabilities.','Cause: People with intellectual disabilities face exclusion from sport.\nResolution: Fund inclusive sports and health programs.\nProof: Participation and program reports.',600],
  ['Athletics','The Trevor Project','Crisis Support for LGBTQ Young People','West Hollywood, CA, USA',34.0900,-118.3617,'https://www.thetrevorproject.org',{x:'https://x.com/TrevorProject',facebook:'https://www.facebook.com/TheTrevorProject',instagram:'https://www.instagram.com/trevorproject'},'Provide crisis intervention and suicide prevention services for LGBTQ young people.','Cause: LGBTQ youth face elevated risk and barriers to support.\nResolution: Fund crisis services and support programs.\nProof: Service and program reports.',500]
];

function main() {
  let raw = fs.readFileSync(FEED_PATH, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const feed = JSON.parse(raw);

  // load existing master to set counters correctly (avoid id collisions)
  let master = { items: [] };
  try {
    let mraw = fs.readFileSync(OUT_MASTER, 'utf8');
    if (mraw.charCodeAt(0) === 0xFEFF) mraw = mraw.slice(1);
    master = JSON.parse(mraw);
  } catch (_) {}

  // initialize counters from existing feed/master ids in blocks
  for (const it of feed.items) {
    const idn = parseInt(it.id, 10);
    if (!Number.isFinite(idn)) continue;
    for (const base of Object.values(CAT_BLOCK)) {
      if (idn > base && idn < base + 10000) counters[base] = Math.max(counters[base]||0, idn - base);
    }
  }
  for (const it of (master.items||[])) {
    const idn = parseInt(it.id, 10);
    if (!Number.isFinite(idn)) continue;
    for (const base of Object.values(CAT_BLOCK)) {
      if (idn > base && idn < base + 10000) counters[base] = Math.max(counters[base]||0, idn - base);
    }
  }

  // ensure all existing items have website/socials fields
  for (const it of feed.items) {
    const m = it._polytab || (it._polytab = {});
    if (m.website === undefined) m.website = null;
    if (m.socials === undefined || typeof m.socials !== 'object' || Array.isArray(m.socials)) m.socials = {};
  }

  const existingKeys = new Set();
  for (const it of feed.items) {
    const org = ((it._polytab && it._polytab.organization) || '').trim().toLowerCase();
    const title = (it.title || '').trim().toLowerCase();
    existingKeys.add(org + '|' + title);
    existingKeys.add(org); // also dedupe by org name
  }

  const addedMaster = [];
  let added = 0;
  for (const g of MORE) {
    const org = (g[1]||'').trim().toLowerCase();
    const title = (g[2]||'').trim().toLowerCase();
    if (existingKeys.has(org) || existingKeys.has(org+'|'+title)) continue;
    const it = block(g[0], g[1], g[2], g[3], g[4], g[5], g[6], g[7], g[8], g[9], g[10]);
    feed.items.push(it);
    addedMaster.push(it);
    existingKeys.add(org);
    existingKeys.add(org+'|'+title);
    added++;
  }

  master.items = (master.items||[]).concat(addedMaster);
  master.version = 1;
  master.updated_at = new Date().toISOString();
  master.description = 'Polytab global charity master list (curated). Public organizations with public HQ locations, official websites, and social links. All entries honest-zero (fundedUSD=0, votesCount=0). No coordinates near private residences; HQ/public locations only.';
  master.id_compartmentalization = {
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
  };

  fs.mkdirSync(path.dirname(OUT_MASTER), { recursive: true });
  fs.writeFileSync(OUT_MASTER, JSON.stringify(master, null, 2) + '\n', 'utf8');
  fs.writeFileSync(FEED_PATH, JSON.stringify(feed, null, 2) + '\n', 'utf8');

  console.log('expanded_added=' + added + ' new_master_total=' + master.items.length + ' feed_total=' + feed.items.length);
}

main();
