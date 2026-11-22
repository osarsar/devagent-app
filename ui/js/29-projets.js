/* « Projets » is now the agent's screen (devagent/web/pages/02-projets.js). The old page stays only
   for its dialogs: they need the projects list, and must refresh the new screen when they are done. */
async function _projetsCache(pid) {
    if (!projectsCache.some(p => p.id === pid)) projectsCache = await api('projects').catch(() => projectsCache);
}
for (const name of ['openMoveModal', 'editProject', 'openDeleteModal']) {
    const base = window[name];
    window[name] = async function (pid, ...rest) { await _projetsCache(pid); return base(pid, ...rest); };
}
const _loadProjectsBase = loadProjects;
loadProjects = async function () {                   // called after every add / edit / move / delete
    await _loadProjectsBase();
    if (currentPage === 'agent:projets') DA.open('projets');
};
const _showProjectDetailBase = showProjectDetail;
showProjectDetail = async function (pid) {            // the old detail panel: its place is the project page now
    if (currentPage === 'agent:projets' || currentPage === 'projects') return;
    return _showProjectDetailBase(pid);
};
