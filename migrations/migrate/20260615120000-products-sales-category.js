'use strict'

const fs = require('fs')
const path = require('path')

let dbm
let type
let seed

exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate
  type = dbm.dataType
  seed = seedLink
}

const runSqlFile = (db, fileName) => {
  const filePath = path.join(__dirname, 'sqls', fileName)

  return new Promise((resolve, reject) => {
    fs.readFile(filePath, { encoding: 'utf-8' }, (err, data) => {
      if (err) return reject(err)

      resolve(data)
    })
  }).then(data => db.runSql(data))
}

exports.up = db => runSqlFile(db, '20260615120000-products-sales-category-up.sql')

exports.down = db => runSqlFile(db, '20260615120000-products-sales-category-down.sql')

exports._meta = {
  version: 1,
}
