import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import type { FastifyInstance } from 'fastify';

/** Serve the built client and art on the same PC and HTTP origin as the game API. */
export function registerClientAssets(app: FastifyInstance): void {
  const root=resolve(process.env.CLIENT_BUILD_PATH || resolve(import.meta.dirname,'../../../client/dist'));
  const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon'};
  // `override` lets an alias route serve a specific file. A Fastify request
  // cannot be cloned with object spread to fake a different path: `url` and
  // `headers` are prototype getters, so the copy arrives with url undefined and
  // the lookup 404s. Pass the path explicitly instead.
  const serve=async(req:any,reply:any,override?:string)=>{
    const url=new URL(override??req.url,'http://localhost');
    let pathname:string;
    try{pathname=decodeURIComponent(url.pathname);}catch{return reply.code(400).send({error:'Invalid asset path'});}
    const file=resolve(root,pathname==='/'?'index.html':pathname.replace(/^\/+/,''));
    if(!file.startsWith(root+sep)||!mime[extname(file)])return reply.code(404).send({error:'Asset not found'});
    try{
      const info=await stat(file);if(!info.isFile())return reply.code(404).send({error:'Asset not found'});
      const etag=`"${info.size}-${Math.round(info.mtimeMs)}"`;
      // Map manifests must revalidate; image revision URLs keep artwork cacheable.
      reply.header('ETag',etag).header('Cache-Control',['.html','.json'].includes(extname(file))?'no-cache':'public, max-age=86400');
      if(req.headers['if-none-match']===etag)return reply.code(304).send();
      return reply.type(mime[extname(file)]).send(createReadStream(file));
    }catch{return reply.code(404).send({error:'Build the client with npm run build:client before serving game assets.'});}
  };
  app.get('/',serve);app.get('/game.html',serve);app.get('/assets/*',serve);app.get('/art/*',serve);app.get('/painter.html',serve);app.get('/admin.html',serve);
  app.get('/board.html',serve);
  // `/board` is the address an organizer will actually type on a projector, so
  // it resolves to the same page rather than relying on them adding `.html`.
  app.get('/board',(req:any,reply:any)=>serve(req,reply,'/board.html'));
}
