/**
 * Seed script for SCRUM40 — PDF Export testing
 * 
 * Creates a test job with:
 * - Scenario A: 1 SCORED candidate
 * - Scenario B: 50 SCORED candidates with varied scores (40–98)
 * - 2 FAILED + 1 PENDING candidates (should be excluded from PDF)
 * 
 * Run: npx ts-node prisma/seedPdfTest.ts
 */
import { prisma } from '../src/lib/prisma';

// First names and last names for generating realistic candidates
const FIRST_NAMES = [
  "Jean", "Marie", "Pierre", "Sophie", "Thomas", "Julie", "Nicolas", "Camille",
  "Alexandre", "Émilie", "Maxime", "Laura", "Antoine", "Clara", "Julien",
  "Léa", "Romain", "Manon", "Hugo", "Chloé", "Adrien", "Sarah", "Lucas",
  "Pauline", "Mathieu", "Alice", "Vincent", "Emma", "Florian", "Margaux",
  "Guillaume", "Anaïs", "Quentin", "Inès", "Damien", "Charlotte", "Thibault",
  "Louise", "Yann", "Océane", "Fabien", "Nadia", "Cédric", "Yasmine", "Rémi",
  "Fatima", "Olivier", "Diane", "Sébastien", "Élise",
];

const LAST_NAMES = [
  "Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit",
  "Durand", "Leroy", "Moreau", "Simon", "Laurent", "Lefebvre", "Michel",
  "Garcia", "David", "Bertrand", "Roux", "Vincent", "Fournier", "Morel",
  "Girard", "André", "Lefèvre", "Mercier", "Dupont", "Lambert", "Bonnet",
  "François", "Martinez", "Legrand", "Garnier", "Faure", "Rousseau", "Blanc",
  "Guérin", "Muller", "Henry", "Roussel", "Nicolas", "Perrin", "Morin",
  "Mathieu", "Clément", "Gauthier", "Dumont", "Lopez", "Fontaine", "Chevalier",
  "Robin",
];

// Realistic strengths, matched and missing criteria for a Senior Software Engineer role
const STRENGTHS_POOL = [
  "Expérience solide en architecture microservices",
  "Maîtrise approfondie de TypeScript et Node.js",
  "Leadership technique reconnu",
  "Contributions open source significatives",
  "Excellente communication technique",
  "Expérience en CI/CD et DevOps",
  "Connaissance approfondie des bases de données SQL et NoSQL",
  "Capacité à mentorer des développeurs juniors",
  "Expérience en méthodologies Agile/Scrum",
  "Solide compréhension des principes SOLID et design patterns",
];

const MATCHED_CRITERIA_POOL = [
  "5+ ans d'expérience en développement backend",
  "Maîtrise de Node.js/Express",
  "Expérience avec PostgreSQL",
  "Connaissance de Docker et conteneurisation",
  "Expérience en développement d'APIs REST",
  "Pratique du code review",
  "Expérience en environnement Agile",
  "Compétences en testing (unit, intégration)",
  "Connaissance de Git et workflows de versioning",
  "Anglais professionnel courant",
];

const MISSING_CRITERIA_POOL = [
  "Pas d'expérience avec Kubernetes en production",
  "Aucune certification cloud (AWS/GCP/Azure)",
  "Peu d'expérience avec les systèmes distribués à grande échelle",
  "Pas de mention de GraphQL",
  "Pas d'expérience en machine learning",
  "Aucune expérience en gestion d'équipe formelle",
  "Pas de contribution open source documentée",
  "Pas d'expérience avec les architectures event-driven",
  "Connaissance limitée des outils de monitoring (Datadog, Grafana)",
  "Aucune expérience avec les bases de données time-series",
];

const VERDICTS: Array<"STRONG_FIT" | "GOOD_FIT" | "PARTIAL_FIT" | "WEAK_FIT"> = [
  "STRONG_FIT", "GOOD_FIT", "PARTIAL_FIT", "WEAK_FIT"
];

/**
 * Generate a realistic scoreExplanation JSON matching the ScoringResult interface
 * from src/workers/cvScorer.worker.ts
 */
function generateScoreExplanation(score: number) {
  // Pick verdict based on score range
  let verdict: typeof VERDICTS[number];
  if (score >= 80) verdict = "STRONG_FIT";
  else if (score >= 60) verdict = "GOOD_FIT";
  else if (score >= 45) verdict = "PARTIAL_FIT";
  else verdict = "WEAK_FIT";

  // Pick random subsets
  const matchedCount = Math.max(2, Math.floor(score / 15));
  const missingCount = Math.max(1, Math.floor((100 - score) / 20));
  const strengthsCount = Math.max(1, Math.floor(score / 20));

  const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);

  return {
    score,
    matchedCriteria: shuffle(MATCHED_CRITERIA_POOL).slice(0, matchedCount),
    missingCriteria: shuffle(MISSING_CRITERIA_POOL).slice(0, missingCount),
    strengths: shuffle(STRENGTHS_POOL).slice(0, strengthsCount),
    verdict,
  };
}

async function main() {
  console.log("🌱 SCRUM40 — Seeding test data for PDF export...\n");

  // Find the existing organisation (Acme Recruiting) and recruiter
  const organisation = await prisma.organisation.findUnique({
    where: { slug: "acme-recruiting" },
  });

  if (!organisation) {
    console.error("❌ Organisation 'acme-recruiting' not found. Run the main seed first.");
    process.exit(1);
  }

  // Find a user in that org to be the job creator
  const creator = await prisma.user.findFirst({
    where: { organisationId: organisation.id },
  });

  if (!creator) {
    console.error("❌ No user found in org. Run the main seed first.");
    process.exit(1);
  }

  console.log(`📋 Organisation: ${organisation.name} (${organisation.id})`);
  console.log(`👤 Creator: ${creator.firstName} ${creator.lastName} (${creator.email})\n`);

  // List existing jobs
  const existingJobs = await prisma.jobOpening.findMany({
    where: { organisationId: organisation.id },
    select: { id: true, title: true, status: true },
  });
  console.log("📂 Existing jobs in this organisation:");
  existingJobs.forEach((j) => console.log(`   - [${j.status}] ${j.title} (${j.id})`));
  console.log();

  // Create a dedicated test job
  const testJob = await prisma.jobOpening.create({
    data: {
      title: "[TEST PDF] Senior Software Engineer — Full Stack",
      profileDescription:
        "Nous recherchons un ingénieur logiciel senior full-stack pour rejoindre notre équipe R&D. " +
        "Le candidat idéal possède 5+ ans d'expérience en développement backend (Node.js, TypeScript) " +
        "et frontend (React), une maîtrise de PostgreSQL, Docker, et des pratiques CI/CD. " +
        "Expérience en architecture microservices et leadership technique appréciée. " +
        "Environnement Agile, équipe internationale, anglais requis.",
      status: "OPEN",
      organisationId: organisation.id,
      createdById: creator.id,
    },
  });

  console.log(`✅ Test job created: "${testJob.title}"`);
  console.log(`   Job ID: ${testJob.id}\n`);

  // ── Scenario A: 1 SCORED candidate ──────────────────────────
  console.log("📌 Scenario A: Creating 1 SCORED candidate...");
  await prisma.candidate.create({
    data: {
      firstName: "Alice",
      lastName: "Dupont",
      email: "alice.dupont@example.com",
      rawFileUrl: "s3://test-bucket/cv-alice-dupont.pdf",
      score: 87,
      scoreExplanation: generateScoreExplanation(87),
      summary: "Développeuse senior avec 8 ans d'expérience en Node.js et React. Excellente en architecture microservices.",
      status: "SCORED",
      jobOpeningId: testJob.id,
    },
  });
  console.log("   ✓ Alice Dupont (score: 87, SCORED)\n");

  // ── Scenario B: 50 SCORED candidates with varied scores ─────
  console.log("📌 Scenario B: Creating 50 SCORED candidates...");
  const scoredCandidates = [];
  for (let i = 0; i < 50; i++) {
    // Generate a score between 40 and 98
    const score = Math.floor(Math.random() * 59) + 40;
    const firstName = FIRST_NAMES[i % FIRST_NAMES.length];
    const lastName = LAST_NAMES[i % LAST_NAMES.length];

    scoredCandidates.push({
      firstName,
      lastName,
      email: `${firstName.toLowerCase().replace(/[éèê]/g, "e").replace(/[àâ]/g, "a").replace(/[ùû]/g, "u").replace(/[ïî]/g, "i").replace(/[ô]/g, "o").replace(/[ç]/g, "c")}.${lastName.toLowerCase().replace(/[éèê]/g, "e").replace(/[àâ]/g, "a")}${i}@example.com`,
      rawFileUrl: `s3://test-bucket/cv-${i}.pdf`,
      score,
      scoreExplanation: generateScoreExplanation(score),
      summary: `Candidat ${firstName} ${lastName} — profil évalué avec un score de ${score}/100.`,
      status: "SCORED" as const,
      jobOpeningId: testJob.id,
    });
  }

  await prisma.candidate.createMany({ data: scoredCandidates });
  console.log("   ✓ 50 SCORED candidates created (scores 40-98)\n");

  // ── Exclusion test: FAILED + PENDING candidates ─────────────
  console.log("📌 Creating FAILED and PENDING candidates (should be excluded from PDF)...");

  await prisma.candidate.createMany({
    data: [
      {
        firstName: "Erreur",
        lastName: "Parsing",
        rawFileUrl: "s3://test-bucket/cv-error-1.pdf",
        status: "FAILED",
        jobOpeningId: testJob.id,
      },
      {
        firstName: "Fichier",
        lastName: "Corrompu",
        rawFileUrl: "s3://test-bucket/cv-error-2.pdf",
        status: "FAILED",
        jobOpeningId: testJob.id,
      },
      {
        firstName: "En",
        lastName: "Attente",
        rawFileUrl: "s3://test-bucket/cv-pending-1.pdf",
        status: "PENDING",
        jobOpeningId: testJob.id,
      },
    ],
  });
  console.log("   ✓ 2 FAILED + 1 PENDING candidates created\n");

  // ── Summary ─────────────────────────────────────────────────
  const totalCandidates = await prisma.candidate.count({
    where: { jobOpeningId: testJob.id },
  });
  const scoredCount = await prisma.candidate.count({
    where: { jobOpeningId: testJob.id, status: "SCORED" },
  });
  const failedCount = await prisma.candidate.count({
    where: { jobOpeningId: testJob.id, status: "FAILED" },
  });
  const pendingCount = await prisma.candidate.count({
    where: { jobOpeningId: testJob.id, status: "PENDING" },
  });

  console.log("════════════════════════════════════════════════════");
  console.log("✅ SEED COMPLETE");
  console.log("════════════════════════════════════════════════════");
  console.log(`   Job ID:    ${testJob.id}`);
  console.log(`   Job Title: ${testJob.title}`);
  console.log(`   Total candidates: ${totalCandidates}`);
  console.log(`     - SCORED:  ${scoredCount} (included in PDF)`);
  console.log(`     - FAILED:  ${failedCount} (excluded from PDF)`);
  console.log(`     - PENDING: ${pendingCount} (excluded from PDF)`);
  console.log();
  console.log(`🔗 Open in app: http://localhost:3000/candidatures/${testJob.id}`);
  console.log(`📥 Test PDF:    GET http://localhost:3001/api/v1/jobs/${testJob.id}/export/pdf`);
  console.log("════════════════════════════════════════════════════");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
