import { ExtensionContext, languages, Position, TextDocument, Hover, Location, Uri, LocationLink, Range, MarkdownString } from 'vscode'
import { dirname } from 'path'
import { constants } from 'fs'
import { access } from 'fs/promises'
import { execCmd, fetch, formatByteSize } from './util'

export function activate(context: ExtensionContext) {
  console.log('vscode-package.json-inspector start');
  const selector = [{ language: 'json', pattern: '**/package.json'}, { language: 'jsonc', pattern: '**/package.json'}]
  context.subscriptions.push(
    // provide hover detail
    languages.registerHoverProvider(selector, { provideHover }),
    // provide right-click to node_modules/
    languages.registerDefinitionProvider(selector, { provideDefinition }),
  )
}

async function provideDefinition(document: TextDocument, position: Position) {
  console.log('vscode-package.json-inspector definition');
  const dependency = await getDependencyPath(document, position)
  if(!dependency || !dependency.exsit) {
    return null
  }
  return [{
    originSelectionRange: dependency.range,
    targetUri: Uri.file(dependency.path),
    targetRange: new Range(new Position(0, 0), new Position(0, 0))
  }] as LocationLink[]
}

async function provideHover(document: TextDocument, position: Position) {
  console.log('vscode-package.json-inspector hover');
  const dependency = await getDependencyPath(document, position)
  if(!dependency || !dependency.exsit) {
    return null
  }
  const dependencyPkg = require(dependency.path)
  const [latestDependencyPkg, dependencyBundlePhobia] = await Promise.all([
    getLatestPkg(dependency.name, dependency.cwd).catch(e => null),
    getBundlePhobiaPkg(`${dependency.name}@${dependencyPkg.version}`).catch(() => null),
  ])
  const hoverContent =
`### ${dependencyPkg.homepage ? `[${dependencyPkg.name}](${dependencyPkg.homepage})` : dependencyPkg.name}
${dependencyPkg.description ? `${dependencyPkg.description}\n` : ''}
🗜️ GZIPPED: ${dependencyBundlePhobia?.gzip 
    ? `[\`${formatByteSize(dependencyBundlePhobia.gzip)}\`](https://bundlephobia.com/package/${dependencyPkg.name}@${dependencyPkg.version})`
    : '\`unknown\`'}\n
✨ VERSION: \`${dependencyPkg.version}\`(current) &nbsp;/&nbsp; \`${latestDependencyPkg?.version || 'unknown'}\`(latest)
`
  return new Hover(hoverContent, dependency.range)
}

async function getDependencyPath(document: TextDocument, position: Position) {
  const pkgNameRule = '(?:@[a-z0-9-*~][a-z0-9-*._~]*/)?[a-z0-9-~][a-z0-9-._~]*'
  const safeDependencyWordRange = document.getWordRangeAtPosition(
    position,
    // reg: "lodash", (including prefix and suffix quotation marks to make it more accurate)
    new RegExp(`"${pkgNameRule}"`)
  )
  if(!safeDependencyWordRange) {
    return null
  }
  const dependencyWordRange = new Range(
    new Position(safeDependencyWordRange.start.line, safeDependencyWordRange.start.character + 1),
    new Position(safeDependencyWordRange.end.line, safeDependencyWordRange.end.character - 1)
  )
  const dependencyName = document.getText(safeDependencyWordRange).replace(/"/g, '')
  const cwd = dirname(document.fileName)
  const dependencyDir = `${cwd}/node_modules/${dependencyName}`
  const dependencyPkgJSON = `${dependencyDir}/package.json`
  const isDependencyExsit = await access(dependencyPkgJSON, constants.R_OK)
    .then(() => true)
    .catch(() => false)
  return {
    cwd,
    name: dependencyName,
    dir: dependencyDir,
    path: dependencyPkgJSON,
    exsit: isDependencyExsit, 
    range: dependencyWordRange 
  }
}

async function getLatestPkg(pkg: string, cwd: string) {
  const registry = await getNpmRegistry(pkg, cwd).catch(() => null)
  if(!registry) {
    return null
  }
  const pkgURL = new URL(`/${pkg}/latest`, registry)
  const pkgJSON = await fetch(pkgURL.href)
  return pkgJSON
}

async function getNpmRegistry(pkg: string, cwd: string) {
  const cmd = 'npm config get registry'
  const scopedCmd = `npm config get ${pkg}:registry`
  const [defaultRegistry, scopedRegistry] = await Promise.all([
    execCmd(cmd, cwd).catch(() => null),
    execCmd(scopedCmd, cwd).catch(() => null),
  ])
  return scopedRegistry || defaultRegistry
}

/** bundlephobia only supports npmjs.com packages */
async function getBundlePhobiaPkg(pkg: string) {
  const result = await fetch(`https://bundlephobia.com/api/size?package=${pkg}&record=true`)
  return result
}
