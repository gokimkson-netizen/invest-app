export const go = (id: string, arg?: string) => { location.hash = `#/${id}${arg ? '/' + encodeURIComponent(arg) : ''}`; };
