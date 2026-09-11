let api = null;
let currentToken = null;
let tokenWaiter = null;

function tokenFromEvent(args) {
  if (typeof args === 'string') return args;
  if (typeof args?.data === 'string') return args.data;
  if (typeof args?.data?.accessToken === 'string') return args.data.accessToken;
  if (typeof args?.accessToken === 'string') return args.accessToken;
  return null;
}

export function isInsideTrimble() {
  return window.parent && window.parent !== window;
}

export async function connectWorkspace(onStatus = () => {}) {
  if (!isInsideTrimble()) throw new Error('Deze pagina draait niet binnen Trimble Connect.');
  if (!window.TrimbleConnectWorkspace?.connect) throw new Error('Trimble Workspace API kon niet worden geladen.');

  api = await window.TrimbleConnectWorkspace.connect(window.parent, (event, args) => {
    if (event === 'extension.accessToken') {
      const token = tokenFromEvent(args);
      if (token && token !== 'pending' && token !== 'denied') {
        currentToken = token;
        tokenWaiter?.resolve?.(token);
        tokenWaiter = null;
        onStatus('token-refreshed', token);
      }
    }
    if (event === 'extension.sessionInvalid' || event === 'extension.sessionLogOut') {
      currentToken = null;
      onStatus('session-invalid');
    }
  }, 30000);

  // Project extensions provide their own left-navigation menu.
  // Failure to set the menu must never block the actual monitor.
  try {
    const icon = new URL('../icon.svg', import.meta.url).href;
    await api.ui.setMenu({
      title: 'ALTEZ IFC Monitor',
      icon,
      command: 'altez_ifc_monitor',
      subMenus: [{ title: 'Dashboard', icon, command: 'dashboard' }]
    });
    await api.ui.setActiveMenuItem('dashboard');
  } catch { /* menu is cosmetic; continue */ }

  return api;
}

export async function requestAccessToken() {
  if (!api) throw new Error('Workspace API is nog niet verbonden.');
  if (currentToken) return currentToken;

  const result = await api.extension.requestPermission('accesstoken');
  if (result && result !== 'pending' && result !== 'denied') {
    currentToken = result;
    return result;
  }
  if (result === 'denied') {
    throw new Error('Toegang tot het Trimble access token werd geweigerd. Pas de toestemming aan bij de extensie-instellingen.');
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      tokenWaiter = null;
      reject(new Error('Geen access token ontvangen. Geef de extensie toestemming wanneer Trimble daarom vraagt.'));
    }, 45000);
    tokenWaiter = {
      resolve: token => { clearTimeout(timeout); resolve(token); },
      reject
    };
  });
}
