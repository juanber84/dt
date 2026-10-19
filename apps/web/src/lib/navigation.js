/** Solo rutas internas en ?next= (que nadie pueda mandar a otra web tras el login). */
export function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !/^\/[/\\]/.test(next) ? next : null;
}
