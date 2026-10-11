/* Topic registry. Topic content lives in src/<folder>/questions.js, loaded on demand.
   `SITE_READY` lists the slugs whose question files are authored; other topics show a "being written" state. */
window.SITE_CATS = [
  { id: 'lang',  name: 'Languages & Frameworks', icon: 'bi-braces',        color: 'var(--c-lang)' },
  { id: 'data',  name: 'Data',                   icon: 'bi-database',      color: 'var(--c-data)' },
  { id: 'cs',    name: 'CS Fundamentals',        icon: 'bi-diagram-3',     color: 'var(--c-cs)' },
  { id: 'arch',  name: 'Architecture',           icon: 'bi-bricks',        color: 'var(--c-arch)' },
  { id: 'msg',   name: 'Messaging',              icon: 'bi-envelope-arrow-up', color: 'var(--c-msg)' },
  { id: 'cloud', name: 'Cloud & DevOps',         icon: 'bi-cloud',         color: 'var(--c-cloud)' },
  { id: 'sec',   name: 'Security',               icon: 'bi-shield-lock',   color: 'var(--c-sec)' },
  { id: 'fe',    name: 'Frontend',               icon: 'bi-window',        color: 'var(--c-fe)' },
  { id: 'lead',  name: 'Leadership',             icon: 'bi-people',        color: 'var(--c-lead)' }
];

(function () {
  // [folderNumber, folder, title, category, icon, related folder-numbers]
  const T = [
    ['01', '01-CSharp', 'C#', 'lang', 'bi-code-slash', ['02', '56', '09']],
    ['02', '02-DotNet-AspNetCore', '.NET / ASP.NET Core', 'lang', 'bi-hdd-network', ['01', '03', '56']],
    ['03', '03-REST-APIs', 'REST APIs', 'lang', 'bi-arrow-left-right', ['02', '38', '41']],
    ['56', '56-LINQ-EFCore', 'LINQ & EF Core', 'lang', 'bi-table', ['01', '04', '02']],
    ['04', '04-SQL-Server', 'SQL Server', 'data', 'bi-server', ['05', '56', '29']],
    ['05', '05-PostgreSQL', 'PostgreSQL', 'data', 'bi-database-gear', ['04', '06', '29']],
    ['06', '06-MongoDB', 'MongoDB', 'data', 'bi-file-earmark-code', ['05', '08', '07']],
    ['07', '07-Redis', 'Redis', 'data', 'bi-lightning-charge', ['08', '14', '29']],
    ['08', '08-DynamoDB', 'DynamoDB', 'data', 'bi-grid-3x3-gap', ['06', '21', '07']],
    ['09', '09-OOP', 'OOP', 'cs', 'bi-boxes', ['10', '11', '01']],
    ['10', '10-SOLID', 'SOLID', 'cs', 'bi-bricks', ['09', '11', '32']],
    ['11', '11-Design-Patterns', 'Design Patterns', 'cs', 'bi-puzzle', ['10', '15', '09']],
    ['12', '12-Data-Structures', 'Data Structures', 'cs', 'bi-node-plus', ['13', '01', '07']],
    ['13', '13-Algorithms', 'Algorithms', 'cs', 'bi-calculator', ['12', '29', '14']],
    ['14', '14-System-Design', 'System Design', 'cs', 'bi-diagram-2', ['16', '17', '15']],
    ['15', '15-Low-Level-Design', 'Low-Level Design', 'cs', 'bi-grid', ['11', '10', '14']],
    ['16', '16-Distributed-Systems', 'Distributed Systems', 'cs', 'bi-share', ['14', '36', '37']],
    ['17', '17-Microservices', 'Microservices', 'arch', 'bi-boxes', ['36', '37', '38']],
    ['30', '30-Architecture-Patterns', 'Architecture Patterns', 'arch', 'bi-columns-gap', ['32', '33', '31']],
    ['31', '31-Domain-Driven-Design', 'Domain-Driven Design', 'arch', 'bi-bounding-box', ['34', '35', '17']],
    ['32', '32-Clean-Architecture', 'Clean Architecture', 'arch', 'bi-bullseye', ['33', '10', '30']],
    ['33', '33-Hexagonal-Architecture', 'Hexagonal Architecture', 'arch', 'bi-hexagon', ['32', '30', '15']],
    ['34', '34-CQRS', 'CQRS', 'arch', 'bi-signpost-split', ['35', '37', '18']],
    ['35', '35-Event-Sourcing', 'Event Sourcing', 'arch', 'bi-journal-text', ['34', '18', '19']],
    ['36', '36-Saga', 'Saga', 'arch', 'bi-arrow-repeat', ['37', '18', '17']],
    ['37', '37-Outbox', 'Outbox', 'arch', 'bi-inbox', ['36', '18', '19']],
    ['38', '38-API-Gateway', 'API Gateway', 'arch', 'bi-door-open', ['39', '03', '41']],
    ['39', '39-Service-Mesh', 'Service Mesh', 'arch', 'bi-bezier2', ['38', '23', '28']],
    ['44', '44-AI-Systems', 'AI Systems', 'arch', 'bi-robot', ['14', '27', '28']],
    ['18', '18-Event-Driven-Architecture', 'Event-Driven Architecture', 'msg', 'bi-broadcast', ['19', '36', '37']],
    ['19', '19-Kafka', 'Kafka', 'msg', 'bi-collection', ['18', '20', '37']],
    ['20', '20-RabbitMQ', 'RabbitMQ', 'msg', 'bi-chat-left-dots', ['19', '18', '36']],
    ['21', '21-AWS', 'AWS', 'cloud', 'bi-cloud-fill', ['22', '23', '08']],
    ['22', '22-Azure', 'Azure', 'cloud', 'bi-cloud-haze', ['21', '23', '25']],
    ['23', '23-Kubernetes', 'Kubernetes', 'cloud', 'bi-gear-wide-connected', ['24', '39', '26']],
    ['24', '24-Docker', 'Docker', 'cloud', 'bi-box-seam', ['23', '26', '25']],
    ['25', '25-DevOps', 'DevOps', 'cloud', 'bi-infinity', ['26', '27', '24']],
    ['26', '26-CICD', 'CI/CD', 'cloud', 'bi-arrow-right-circle', ['25', '24', '23']],
    ['27', '27-Observability', 'Observability', 'cloud', 'bi-activity', ['29', '25', '17']],
    ['29', '29-Performance-Engineering', 'Performance Engineering', 'cloud', 'bi-speedometer2', ['27', '04', '01']],
    ['28', '28-Security', 'Security', 'sec', 'bi-shield-check', ['40', '41', '38']],
    ['40', '40-IAM', 'IAM', 'sec', 'bi-person-badge', ['41', '28', '21']],
    ['41', '41-OAuth2-OIDC-JWT-PKCE', 'OAuth2 / OIDC / JWT / PKCE', 'sec', 'bi-key', ['40', '28', '38']],
    ['42', '42-Angular', 'Angular', 'fe', 'bi-triangle', ['43', '03', '41']],
    ['43', '43-React', 'React', 'fe', 'bi-circle-square', ['42', '03', '41']],
    ['51', '51-Engineering-Leadership', 'Engineering Leadership', 'lead', 'bi-person-workspace', ['30', '14', '25']]
  ];
  const byNum = {};
  window.SITE_TOPICS = T.map(([n, folder, title, cat, icon, rel]) => {
    const t = { n, folder, slug: folder.toLowerCase(), title, cat, icon, rel, count: 50, data: folder + '/questions.js' };
    byNum[n] = t; return t;
  }).sort((a, b) => +a.n - +b.n); // the brief's order (01 … 44, 51, 56); the sidebar still groups by category
  window.SITE_TOPICS.forEach(t => { t.related = t.rel.map(n => byNum[n].slug); });


  // Slugs with authored question files. Update as topics are written.
  window.SITE_READY = ['01-csharp','02-dotnet-aspnetcore','03-rest-apis','04-sql-server','05-postgresql','06-mongodb','07-redis','08-dynamodb','09-oop','10-solid','11-design-patterns','12-data-structures','13-algorithms','14-system-design','15-low-level-design','16-distributed-systems','17-microservices','18-event-driven-architecture','19-kafka','20-rabbitmq','21-aws','22-azure','23-kubernetes','24-docker','25-devops','30-architecture-patterns','36-saga'];
  window.SITE_UPDATED = '2026-10-11';
})();
