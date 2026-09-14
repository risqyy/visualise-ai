/** Generate concrete implemented REST branches from the frozen #76 schema.
 * --check verifies both the generated block and the embedded backend copy.
 * Other definitions are published as MV_* for future adapters; registering
 * tools/events remains explicit and is not inferred from schema availability.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { parse, stringify } from 'yaml'
const root = new URL('../', import.meta.url)
const specURL = new URL('openapi.yaml', root)
const copyURL = new URL('../backend/internal/ingest/contract/openapi.yaml', root)
const original = (await readFile(specURL, 'utf8')).replaceAll('\r\n', '\n')
const source = parse(await readFile(new URL('model-view-mcp.schema.yaml', root), 'utf8'))
const marker = '    # GENERATED MODEL COMMAND SCHEMAS — npm run generate:model-contract\n'
let base = original.split(marker)[0].trimEnd() + '\n\n'
const legacy = parse(original)
const implemented = { 'model.mutation_applied': 'ModelMutationApplied', 'context.opened': 'ContextOpened', 'work.reported': 'WorkReported', 'work.scope_reported': 'WorkScopeReported', 'view.saved': 'ViewSaved', 'view.removed': 'ViewRemoved' }
for (const [type, name] of Object.entries(implemented).slice(1)) {
 if (!base.includes(`          ${type}:`)) {
  base = base.replace("        - model.mutation_applied", `        - model.mutation_applied\n        - ${type}`)
  for (const prefix of ['', 'Streamed']) {
   base = base.replace(`        - $ref: '#/components/schemas/${prefix}ModelMutationAppliedEvent'`, `        - $ref: '#/components/schemas/${prefix}ModelMutationAppliedEvent'\n        - $ref: '#/components/schemas/${prefix}${name}Event'`)
   base = base.replace(`          model.mutation_applied: '#/components/schemas/${prefix}ModelMutationAppliedEvent'`, `          model.mutation_applied: '#/components/schemas/${prefix}ModelMutationAppliedEvent'\n          ${type}: '#/components/schemas/${prefix}${name}Event'`)
  }
 }
}
const rewrite = value => {
 if (value?.$ref && /\/properties\//.test(value.$ref)) {
  const ref = value.$ref
  const doc = ref.startsWith('urn:') ? legacy : source
  const pointer = ref.slice(ref.indexOf('#') + 2).split('/')
  let resolved = doc
  for (const part of pointer) resolved = resolved[part]
  if (!resolved) throw new Error('Unresolved reference ' + ref)
  return rewrite(structuredClone(resolved))
 }
 if (Array.isArray(value)) return value.map(rewrite)
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key, key === '$ref' ? item.replace(/^#\/\$defs\//, '#/components/schemas/MV_').replace(/^urn:visualise-ai:rest:1\.1\.0#/, '#') : rewrite(item)]))
 return value
}
const definitions = Object.fromEntries(Object.entries(source.$defs).map(([name, schema]) => ['MV_' + name, rewrite(schema)]))
definitions.LegacyEventType = { type: 'string', enum: legacy.components.schemas.EventType.enum.filter(type => !implemented[type]) }
for (const [type, name] of Object.entries(implemented)) {
const event = rewrite(source.$defs.CommandEvent)
const branch = event.oneOf.find(branch => branch.properties.type.const === type)
delete event.oneOf
Object.assign(event.properties, branch.properties)
event.description = `${type} command, generated from contract 2.0.0.`
definitions[name + 'Event'] = event
const streamed = structuredClone(event)
Object.assign(streamed.properties, {
 position: {type:'integer',minimum:1},
 serverEventId: {$ref:'#/components/schemas/Uuid'},
 receivedAt: {$ref:'#/components/schemas/Timestamp'},
})
streamed.required.push('position','serverEventId','receivedAt')
definitions['Streamed' + name + 'Event'] = streamed
}
const generated = stringify(definitions, {lineWidth:100}).split('\n').filter((line,index,array) => index < array.length - 1 || line).map(line => '    ' + line).join('\n') + '\n'
const expected = base + marker + generated
// Fully local, closed tool schemas are derived from the same catalogue. Clients
// never need to fetch a private URN or know an internal REST event envelope.
const expand = value => {
 if (Array.isArray(value)) return value.map(expand)
 if (!value || typeof value !== 'object') return value
 if (value.$ref) {
  const ref=value.$ref; let resolved=ref.startsWith('urn:') || ref.startsWith('#/components/') ? legacy : source
  for (const part of ref.slice(ref.indexOf('#')+2).split('/')) resolved=resolved[part]
  if (!resolved) throw new Error('Unresolved MCP schema '+ref)
  const {$ref,...siblings}=value
  return {...expand(resolved),...expand(siblings)}
 }
 return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,expand(item)]))
}
const catalogue=parse(await readFile(new URL('model-view-mcp.tools.yaml',root),'utf8'))
const toolSchemas=Object.fromEntries(catalogue.tools.map(tool=>[tool.name,{input:expand({$ref:tool.inputSchema}),output:expand({$ref:tool.outputSchema}),eventType:tool.eventType??null}]))
toolSchemas.error=expand(source.$defs.Error)
const toolURL=new URL('../backend/internal/mcptools/schemas.json',root)
const toolJSON=JSON.stringify(toolSchemas,null,2)+'\n'
if (process.argv.includes('--check')) {
 if (original !== expected || (await readFile(copyURL,'utf8')).replaceAll('\r\n','\n') !== expected) throw new Error('Generated model contract drift: run npm run generate:model-contract')
 if ((await readFile(toolURL,'utf8')).replaceAll('\r\n','\n') !== toolJSON) throw new Error('Generated MCP schemas drift')
 console.log('Generated model command schemas and embedded contract match')
} else {
 await writeFile(specURL, expected)
 await writeFile(copyURL, expected)
 await mkdir(new URL('../backend/internal/mcptools/',root),{recursive:true})
 await writeFile(toolURL,toolJSON)
 console.log('Generated model command schemas and embedded contract')
}
