'use strict'

const path         = require('path')
const fs           = require('co-fs-extra')
const compact      = require('lodash.compact')
const Octokat      = require('octokat')
const promiseRetry = require('promise-retry')

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const REPOS_LENGTH = process.env.REPOS_LENGTH || 100
const SAVE_DIR     = 'packages'

class GitHub {
  constructor(octo) {
    this.octo = octo
  }

  async getRepos(length) {
    const repos = []
    const query = {
      l: 'JavaScript',
      q: 'stars:>1',
      s: 'star',
    }

    let result = await promiseRetry(() => this.octo.search.repositories.fetch(query))
    repos.push(... result.items)

    while (repos.length < length) {
      result = await promiseRetry(() => result.nextPage())
      repos.push(... result.items)
    }

    return repos.slice(0, length)
  }

  async getPkg(fullName) {
    try {
      return this.octo.repos(fullName).contents('package.json').read()
    } catch (e) {
      if (e.message !== 'Not Found') {
        throw e
      }
    }
  }
}

async function clearSaveDir() {
  if (await fs.access(SAVE_DIR)) {
    await fs.remove(SAVE_DIR)
  }
}

async function savePkgs(pkg) {
  const dir      = pkg.fullName.replace('/', '_')
  const fullDir  = path.join(SAVE_DIR, dir)
  const fullPath = path.join(fullDir, 'package.json')

  await fs.mkdirp(fullDir)
  await fs.writeFile(fullPath, pkg.data)
}

!async function() {
  try {
    const octo = new Octokat({ token: GITHUB_TOKEN })
    const gh   = new GitHub(octo)

    // search repositories
    const repos = await gh.getRepos(REPOS_LENGTH)
    console.info(`Find ${repos.length} JavaScript repos`)

    // download all package.json
    const pkgs = compact(await Promise.all(repos.map(async repo => {
      try {
        return {
          name    : repo.name,
          fullName: repo.fullName,
          data    : await promiseRetry(()=> gh.getPkg(repo.fullName)),
        }
      } catch (e) { }
    })))
    console.info(`Find ${pkgs.length} package.json files`)

    // save
    await clearSaveDir()
    await Promise.all(pkgs.map(async pkg => await savePkgs(pkg)))
    console.info(`Save ${pkgs.length} package.json files`)

    console.info('Successful')
  } catch (e) {
    console.error('Error', e)
  }
}()
