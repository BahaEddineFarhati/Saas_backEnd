import { prisma } from '../src/lib/prisma';
import { LLMFeature } from '@prisma/client';

/**
 * Seed 12 months of realistic LLM usage data for the Acme Recruiting org.
 * Run with: npx tsx prisma/seed-usage.ts
 */
async function main() {
  console.log('🌱 Seeding LLM usage data...\n');

  // Find the Acme Recruiting organisation
  const organisation = await prisma.organisation.findFirst();

  if (!organisation) {
    console.log('❌ No organisation found. Run standard seed first.');
    return;
  }

  console.log(`📌 Organisation: ${organisation.name} (${organisation.id})`);

  // Find any user in the org (needed for logs)
  const user = await prisma.user.findFirst({
    where: { organisationId: organisation.id },
  });

  if (!user) {
    console.log('❌ No user found in org. Run standard seed first.');
    return;
  }

  // Clear existing usage data
  await prisma.lLMUsageLog.deleteMany({ where: { organisationId: organisation.id } });
  await prisma.lLMUsageSummary.deleteMany({ where: { organisationId: organisation.id } });
  console.log('🗑  Cleared existing usage data');

  // Generate 12 months of summaries (growing trend)
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentYear = now.getFullYear();

  // Base values — will scale up over time to show a growth trend
  const baseTokens = {
    cvParsing: 2800,
    cvScoring: 1600,
    cvEnrichment: 900,
    chat: 1200,
  };

  for (let i = 11; i >= 0; i--) {
    let m = currentMonth - i;
    let y = currentYear;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }

    // Growth factor: oldest month = 0.3x, newest month = 1.4x
    const growthFactor = 0.3 + ((11 - i) / 11) * 1.1;
    // Add some monthly variation (±20%)
    const jitter = () => 0.8 + Math.random() * 0.4;

    const cvParsing = Math.round(baseTokens.cvParsing * growthFactor * jitter());
    const cvScoring = Math.round(baseTokens.cvScoring * growthFactor * jitter());
    const cvEnrichment = Math.round(baseTokens.cvEnrichment * growthFactor * jitter());
    const chat = Math.round(baseTokens.chat * growthFactor * jitter());

    const totalTokens = cvParsing + cvScoring + cvEnrichment + chat;
    const promptTokens = Math.round(totalTokens * 0.65);
    const completionTokens = totalTokens - promptTokens;
    const callCount = Math.round(totalTokens / 350); // ~350 tokens per call average

    await prisma.lLMUsageSummary.create({
      data: {
        organisationId: organisation.id,
        month: m,
        year: y,
        totalTokens,
        promptTokens,
        completionTokens,
        cvParsingTokens: cvParsing,
        cvScoringTokens: cvScoring,
        cvEnrichmentTokens: cvEnrichment,
        chatTokens: chat,
        callCount,
      },
    });

    const monthLabel = new Date(y, m - 1).toLocaleDateString('fr-FR', {
      month: 'short',
      year: 'numeric',
    });
    console.log(`  📊 ${monthLabel}: ${totalTokens.toLocaleString()} tokens (${callCount} calls)`);
  }

  // Create some log entries for the current month
  const features: LLMFeature[] = ['CV_PARSING', 'CV_SCORING', 'CV_ENRICHMENT', 'CHAT'];
  const models = ['mistral-small-latest', 'mistral', 'llama3'];

  for (let j = 0; j < 15; j++) {
    const feature = features[Math.floor(Math.random() * features.length)];
    const model = models[Math.floor(Math.random() * models.length)];
    const promptTokens = 100 + Math.round(Math.random() * 400);
    const completionTokens = 80 + Math.round(Math.random() * 300);

    await prisma.lLMUsageLog.create({
      data: {
        organisationId: organisation.id,
        userId: user.id,
        feature,
        provider: 'local',
        model,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        month: currentMonth,
        year: currentYear,
        createdAt: new Date(
          currentYear,
          currentMonth - 1,
          1 + Math.floor(Math.random() * Math.min(14, now.getDate())),
          8 + Math.floor(Math.random() * 10),
          Math.floor(Math.random() * 60)
        ),
      },
    });
  }

  console.log(`\n  📝 Created 15 usage log entries for current month`);

  // Verify
  const summaryCount = await prisma.lLMUsageSummary.count({
    where: { organisationId: organisation.id },
  });
  const logCount = await prisma.lLMUsageLog.count({
    where: { organisationId: organisation.id },
  });
  console.log(`\n✅ Done! ${summaryCount} summaries, ${logCount} log entries created.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
