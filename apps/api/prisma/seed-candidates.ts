import { prisma } from '../src/lib/prisma';

async function main() {
  try {
    console.log('🌱 Starting dummy candidates seeding...\n');

    // Find the Acme Recruiting organisation
    const organisation = await prisma.organisation.findUnique({
      where: { slug: 'acme-recruiting' },
    });

    if (!organisation) {
      console.log('❌ Acme Recruiting organisation not found. Run standard seed first.');
      return;
    }

    // Find the Senior Software Engineer job
    const job = await prisma.jobOpening.findFirst({
      where: {
        title: 'Senior Software Engineer',
        organisationId: organisation.id,
      },
    });

    if (!job) {
      console.log('❌ Senior Software Engineer job not found. Run standard seed first.');
      return;
    }

    // Define dummy candidates
    const candidateData = [
      {
        firstName: 'Jean',
        lastName: 'Dupont',
        email: 'jean.dupont@email.com',
        status: 'SCORED' as const,
        rawFileUrl: 'https://example.com/cv-jean.pdf',
        score: 85,
        scoreExplanation: {
          verdict: 'YES',
          matchedCriteria: [
            '5+ ans d’expérience en Node.js',
            'Maîtrise de TypeScript et Express',
            'Bonne connaissance de SQL et PostgreSQL',
            'Expérience avec Docker'
          ],
          missingCriteria: [
            'Expérience avec Kubernetes / GCP',
            'Anglais bilingue'
          ],
          strengths: [
            'Excellente expertise technique backend',
            'Autonomie sur la conception de bases de données'
          ]
        },
        summary: 'Jean est un développeur backend senior avec 6 ans d’expérience. Il a principalement travaillé sur des architectures microservices en Node.js/TypeScript.',
        interviewQuestions: [
          {
            question: 'Pouvez-vous expliquer le cycle de vie d’une requête Express ?',
            rationale: 'Pour valider sa compréhension en profondeur d’Express.'
          },
          {
            question: 'Comment gérez-vous les transactions complexes avec Prisma ?',
            rationale: 'Pour évaluer son niveau d’expertise sur l’ORM utilisé dans notre stack.'
          }
        ],
        parsedJson: {
          workExperience: [
            {
              title: 'Développeur Backend Senior',
              company: 'TechCorp Solutions',
              startDate: '2022',
              endDate: 'Présent',
              current: true,
              description: 'Conception et développement d’APIs hautement disponibles en TypeScript.'
            },
            {
              title: 'Développeur Fullstack',
              company: 'WebAgency',
              startDate: '2019',
              endDate: '2022',
              current: false,
              description: 'Création d’applications web avec Vue.js et Node.js.'
            }
          ],
          education: [
            {
              degree: 'Master en Informatique',
              school: 'Université de Technologie',
              startDate: '2014',
              endDate: '2019'
            }
          ],
          skills: ['Node.js', 'TypeScript', 'PostgreSQL', 'Docker', 'REST API', 'GraphQL'],
          languages: [
            { language: 'Français', level: 'Natif' },
            { language: 'Anglais', level: 'Professionnel' }
          ]
        }
      },
      {
        firstName: 'Marie',
        lastName: 'Martin',
        email: 'marie.martin@email.com',
        status: 'SCORED' as const,
        rawFileUrl: 'https://example.com/cv-marie.pdf',
        score: 92,
        scoreExplanation: {
          verdict: 'STRONG_YES',
          matchedCriteria: [
            '5+ ans d’expérience en Node.js',
            'Maîtrise de TypeScript et Express',
            'Bonne connaissance de SQL et PostgreSQL',
            'Expérience avec Docker',
            'Expérience avec Kubernetes / GCP'
          ],
          missingCriteria: [
            'Anglais bilingue'
          ],
          strengths: [
            'Très fort profil cloud / devops en plus du backend',
            'Excellente communication technique'
          ]
        },
        summary: 'Marie est ingénieure backend senior spécialisée dans les environnements cloud. Très à l’aise avec Node.js et Kubernetes, elle a mené plusieurs projets de migration d’infrastructure.',
        interviewQuestions: [
          {
            question: 'Comment optimisez-vous le scaling d’un pod Node.js sur Kubernetes ?',
            rationale: 'Pour approfondir ses compétences Devops appliquées au backend.'
          }
        ],
        parsedJson: {
          workExperience: [
            {
              title: 'Lead Backend Engineer',
              company: 'CloudFlow Services',
              startDate: '2021',
              endDate: 'Présent',
              current: true,
              description: 'Supervision de la stack backend et transition vers une architecture Kubernetes.'
            },
            {
              title: 'Développeur Backend Node.js',
              company: 'SaaS Factory',
              startDate: '2017',
              endDate: '2021',
              current: false,
              description: 'Développement du backend principal de la solution SaaS en Node.js.'
            }
          ],
          education: [
            {
              degree: 'Diplôme d’Ingénieur',
              school: 'École Nationale Supérieure d’Informatique',
              startDate: '2012',
              endDate: '2017'
            }
          ],
          skills: ['Node.js', 'TypeScript', 'Kubernetes', 'GCP', 'PostgreSQL', 'Docker', 'Redis'],
          languages: [
            { language: 'Français', level: 'Natif' },
            { language: 'Anglais', level: 'Courant' }
          ]
        }
      },
      {
        firstName: 'Pierre',
        lastName: 'Dubois',
        email: 'pierre.dubois@email.com',
        status: 'SCORED' as const,
        rawFileUrl: 'https://example.com/cv-pierre.pdf',
        score: 74,
        scoreExplanation: {
          verdict: 'MAYBE',
          matchedCriteria: [
            'Maîtrise de TypeScript et Express',
            'Bonne connaissance de SQL et PostgreSQL'
          ],
          missingCriteria: [
            '5+ ans d’expérience en Node.js (a 3 ans)',
            'Expérience avec Docker',
            'Expérience avec Kubernetes / GCP'
          ],
          strengths: [
            'Motivation et fort potentiel de progression',
            'Bonne compréhension des architectures REST'
          ]
        },
        summary: 'Pierre a 3 ans d’expérience sur Node.js. Bien qu’un peu junior pour un poste senior, il dispose de bases solides et est prêt à monter en compétence sur la partie infrastructure/cloud.',
        interviewQuestions: [
          {
            question: 'Quelle est la différence entre processus et threads en Node.js ?',
            rationale: 'Pour tester ses connaissances fondamentales en architecture Node.'
          }
        ],
        parsedJson: {
          workExperience: [
            {
              title: 'Développeur Node.js',
              company: 'WebStart Agency',
              startDate: '2021',
              endDate: 'Présent',
              current: true,
              description: 'Développement d’applications web et intégration d’APIs tierces.'
            }
          ],
          education: [
            {
              degree: 'Licence Professionnelle Informatique',
              school: 'IUT',
              startDate: '2018',
              endDate: '2021'
            }
          ],
          skills: ['Node.js', 'Express', 'TypeScript', 'MongoDB', 'PostgreSQL', 'Git'],
          languages: [
            { language: 'Français', level: 'Natif' },
            { language: 'Anglais', level: 'Intermédiaire' }
          ]
        }
      }
    ];

    // Seed candidates
    for (const cData of candidateData) {
      const existing = await prisma.candidate.findFirst({
        where: { email: cData.email, jobOpeningId: job.id }
      });

      if (!existing) {
        await prisma.candidate.create({
          data: {
            firstName: cData.firstName,
            lastName: cData.lastName,
            email: cData.email,
            status: cData.status,
            rawFileUrl: cData.rawFileUrl,
            score: cData.score,
            scoreExplanation: cData.scoreExplanation,
            summary: cData.summary,
            interviewQuestions: cData.interviewQuestions,
            parsedJson: cData.parsedJson,
            jobOpeningId: job.id,
          }
        });
        console.log(`✓ Candidate created: ${cData.firstName} ${cData.lastName}`);
      } else {
        console.log(`✓ Candidate already exists: ${cData.firstName} ${cData.lastName}`);
      }
    }

    console.log('\n✅ Dummy candidates seeded successfully!');
  } catch (error) {
    console.error('❌ Seeding candidates failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
