/* eslint-disable no-restricted-syntax */
/* eslint-disable no-underscore-dangle */
/* eslint-disable prefer-arrow-callback */
/* eslint-disable func-names */
/* eslint-disable consistent-return */
const async = require('async');

const Query = (args) => {
  let query = {};

  if (args.length === 1) {
    query = args[0] || {};
  } else if (args.length > 1) {
    query = args[args.length - 1];
  }

  const {
    populate = null,
    condition = {},
    fields = null,
    sort = {},
    limit = null,
    skip = 0,
    id = null,
  } = query;

  return {
    query,
    populate,
    condition,
    fields,
    sort,
    limit,
    skip,
    id,
  };
};

/**
 * Mongoose materialized path plugin
 */

const materialized = (schema, options = {}) => {
  const { field = '_id', separator = ',', mapLimit = 5 } = options;
  const byId = (value) => ({ [field]: value });
  const addId = (fields) => ({ ...fields, ...{ [field]: 1 } });

  // set parentId type
  let parentType = 'ObjectId';
  if (field in schema.paths) {
    // eslint-disable-next-line operator-linebreak
    parentType =
      schema.paths[field].instance === 'ObjectID'
        ? 'ObjectId'
        : schema.paths[field].instance;
  }

  // add custom fields
  schema.add({ parentId: { type: parentType, default: null } });
  schema.add({ path: { type: 'string', required: false } });
  schema.add({ _w: { type: 'number', default: 0 } }); // order with weight

  // add indexes
  schema.index({ parentId: 1 });
  schema.index({ path: 1 });

  // save prevesious version
  schema.path('parentId').set(function (v) {
    // if (v.toString() !== this.parentId.toString()) {
    this.__parentId = this.parentId;
    this.__path = this.path;
    return v;
    // }
  });

  schema.pre('save', function (next) {
    const self = this;
    const isPidChange = self.isModified('parentId');

    // updates do not affect structure
    if (!self.isNew && !isPidChange) {
      return next();
    }

    // if create root element
    if (self.isNew && !self.parentId) {
      this.path = '';
      this.parentId = null;
      return next();
    }

    // if create child element
    if (self.isNew && self.parentId) {
      self.constructor
        .findOne(byId(self.parentId), addId({ path: 1 }))
        .exec(function (err, parent) {
          if (err || !parent) {
            self.invalidate('parentId', 'Parent not found!');
            return next(new Error('Parent not found!'));
          }

          self.path = parent.path + separator + parent[field].toString();
          next();
        });

      return false;
    }

    // extisting element and updating structure
    if (!self.isNew && isPidChange) {
      // --- update childs function -----------------------------
      const updateChilds = function () {
        self.constructor
          .find({
            path: new RegExp(
              `^${self.__path}${separator}${self[field].toString()}`,
              'g',
            ),
          })
          .exec(function (err1, docs) {
            // replace from RegExp
            const regEx = new RegExp(`^${self.__path}`, 'g');
            // update documents
            async.mapLimit(
              docs,
              mapLimit,
              function (doc, cbNext) {
                Object.assign(doc, {
                  path: doc.path.replace(regEx, self.path),
                });

                doc.save(function (err2, data) {
                  cbNext(err2, data);
                });
              },
              function () {
                next();
              },
            );
          });
      };

      // --- save data end update childs ------------------------
      if (!self.parentId) {
        self.path = '';
        // update childs
        updateChilds();
      } else {
        self.constructor
          .findOne(byId(self.parentId), addId({ path: 1 }))
          .exec(function (err, newParent) {
            if (err || !newParent) {
              self.invalidate('parentId', 'Parent not found!');
              return next(new Error('Parent not found!'));
            }

            self.path = `${newParent.path}${separator}${newParent[
              field
            ].toString()}`;

            // update childs
            updateChilds();
          });
      }
    }
  });

  schema.pre('remove', function (next) {
    const path = {
      $regex: (this.path ? '' : '^') + separator + this[field].toString(),
    };

    this.constructor.deleteMany({ path }, function () {
      next();
    });
  });

  schema.static('Remove', function (conditions = {}) {
    const self = this;

    return new Promise((resolve, reject) => {
      self.find(conditions).exec(function (err1, docs) {
        async.mapLimit(
          docs,
          mapLimit,
          function (doc, cbNext) {
            doc.remove(function (err) {
              cbNext(err, null);
            });
          },
          function (err2) {
            if (err2) {
              return reject(err2);
            }

            resolve();
          },
        );
      });
    });
  });

  schema.method('setParent', function (elementOrId) {
    //  if (elementOrId._id)
    //    return this.__parent = elementOrId;
    this.parentId = elementOrId;
  });

  // --- checkers ------------------------------------------------
  schema.static('IsRoot', async function (elOrId) {
    const id = elOrId[field] || elOrId;

    if (elOrId[field] && elOrId.path) {
      return Promise.resolve(elOrId.path.length === 0);
    }

    const doc = await this.findOne(byId(id), addId({ path: 1 })).exec();
    return Promise.resolve(doc.path.length === 0);
  });

  schema.method('isRoot', function () {
    return Promise.resolve(this.path.length === 0);
  });

  schema.static('IsLeaf', async function (elOrId) {
    const id = elOrId[field] || elOrId;
    const doc = await this.findOne({ parentId: id }, addId()).exec();
    return Promise.resolve(doc === null);
  });

  schema.method('isLeaf', async function () {
    const doc = await this.constructor
      .findOne({ parentId: this[field] }, addId())
      .exec();

    return Promise.resolve(doc === null);
  });

  schema.method('isParent', function (elOrId) {
    const id = elOrId[field] || elOrId;
    return Promise.resolve(this.path.indexOf(separator + id) !== -1);
  });

  schema.method('isDescendant', async function (elOrId) {
    const id = elOrId[field] || elOrId;

    if (elOrId[field] && elOrId[field].path) {
      return Promise.resolve(
        elOrId.path.indexOf(separator + this[field].toString()) !== -1,
      );
    }

    const doc = await this.constructor
      .findOne(byId(id), addId({ path: 1, parentId: 1 }))
      .exec();

    return Promise.resolve(
      doc.path.indexOf(separator + this[field].toString()) !== -1,
    );
  });

  schema.method('isSibling', async function (elOrId) {
    const id = elOrId[field] || elOrId;

    if (elOrId[field] && elOrId[field].parentId) {
      return Promise.resolve(
        elOrId.parentId.toString() === this.parentId.toString(),
      );
    }

    const doc = await this.constructor
      .findOne(byId(id), addId({ path: 1, parentId: 1 }))
      .exec();

    return Promise.resolve(
      doc.parentId.toString() === this.parentId.toString(),
    );
  });

  // --- element getters ------------------------------------------
  schema.method('getParent', function () {
    return this.constructor.findOne(byId(this.parentId));
  });

  schema.method('getDescendants', function (...args) {
    const { condition, sort, fields, limit, skip, populate } = Query(args);

    condition.path = {
      $regex: (this.path ? '' : '^') + separator + this[field].toString(),
    };

    sort.path = 1;
    sort._w = sort._w || 1;

    const cursor = this.constructor.find(condition, fields).sort(sort);

    if (limit) cursor.limit(limit);
    if (skip) cursor.skip(skip);
    if (populate) cursor.populate(populate);

    return cursor.exec();
  });

  schema.method('getChildren', function (QueryOrCb) {
    /*
    if (typeof callback === 'function')
      return this.getDescendants(QueryOrCb, callback);
    */

    return this.getDescendants(QueryOrCb);
  });

  schema.method('getTree', async function (...args) {
    const query = Query(args);
    const childs = await this.getDescendants(query.query);
    childs.unshift(this);
    return this.constructor.ToTree(childs);
  });

  schema.method('getArrayTree', async function (...args) {
    const { query } = Query(args);
    const childs = await this.getDescendants(query);
    childs.unshift(this);
    return this.constructor.ToArrayTree(childs);
  });

  schema.method('getAncestors', function (...args) {
    const { condition, sort, fields, limit, skip, populate } = Query(args);

    if (this.path.length > 2) {
      const ancArray = this.path.substr(1).split(separator);
      condition[field] = {
        $in: ancArray,
      };

      sort.path = 1;
      sort._w = sort._w || 1;

      const cursor = this.constructor.find(condition, fields).sort(sort);

      if (limit) cursor.limit(limit);
      if (skip) cursor.skip(skip);
      if (populate) cursor.populate(populate);

      return cursor.exec();
    }

    return [];
  });

  schema.method('getSiblings', function (...args) {
    const { condition, sort, fields, limit, skip, populate } = Query(args);

    condition.parentId = this.parentId;
    condition[field] = { $ne: this[field] };

    sort.path = 1;
    sort._w = sort._w || 1;

    const cursor = this.constructor.find(condition, fields).sort(sort);

    if (limit) cursor.limit(limit);
    if (skip) cursor.skip(skip);
    if (populate) cursor.populate(populate);

    return cursor.exec();
  });

  schema.virtual('depth').get(function () {
    if (this.__depth || this.__depth === 0) return this.__depth;

    this.__depth = this.path
      ? this.path.match(new RegExp(separator, 'g')).length
      : 0;

    return this.__depth;
  });

  // --- conditions ------------------------------------------
  schema.method('getChildCondition', function getChildCondition() {
    return {
      path: {
        $regex: (this.path ? '' : '^') + separator + this[field].toString(),
      },
    };
  });

  schema.method('getAncestorsCondition', function getAncestorsCondition() {
    if (this.path.length > 2) {
      const ancArray = this.path.substr(1).split(separator);
      const res = {};
      res[field] = { $in: ancArray };
      return res;
    }
    return {};
  });

  schema.method('getSiblingsCondition', function getSiblingsCondition() {
    const res = { parentId: this.parentId };
    res[field] = { $ne: this[field] };
    return res;
  });

  // --- data manupulation -----------------------------------------------------
  schema.method('appendChild', function (child) {
    if (!child.save) {
      child = new this.constructor(child);
    }

    child.setParent(this);
    return child.save();
  });

  schema.static('AppendChild', function (parentElOrId, child) {
    if (!child.save) {
      child = new this.constructor(child);
    }

    child.setParent(parentElOrId);
    return child.save();
  });

  schema.static('GetChildren', async function (id, ...args) {
    const { query } = Query(args);
    const doc = await this.findOne(byId(id)).exec();
    return doc.getChildren(query);
  });

  schema.static('GetRoots', function (...args) {
    const { condition, sort } = Query(args);
    condition.parentId = null;
    sort._w = sort._w || 1;
    return this.find(condition).sort(sort).exec();
  });

  schema.static('ToTree', function (docs, fields) {
    const jdocs = {};
    const map = [];
    // const maxDepth = 0;

    for (let i = 0, len = docs.length; i < len; i++) {
      // var el = docs.pop().toObject({virtuals: true});
      const el = docs[i].toObject({ virtuals: true });
      // var el = docs[i];

      if (el.parentId) {
        map[i] = {
          index: i,
          from: el[field].toString(),
          to: el.parentId.toString(),
          depth: el.depth,
        };
      }
      // filter selected fields
      if (fields) {
        const selected = {};
        for (const j in fields) {
          if (fields[j] && typeof el[j] !== 'undefined') selected[j] = el[j];
        }

        jdocs[el[field].toString()] = selected;
      } else {
        jdocs[el[field].toString()] = el;
      }
    }

    // sort by depth desc
    map.sort(function (a, b) {
      const res = b.depth - a.depth;
      return res === 0 ? a.index - b.index : res;
    });

    // for debug
    /*
    console.log("Map log:")
    for(var i in map){
        if (jdocs[map[i].to])
            console.log(jdocs[map[i].to].name +" = "+ jdocs[map[i].from].name);
        else
            console.log("parent = "+ jdocs[map[i].from].name);
    }
    */

    for (const i in map) {
      if (!jdocs[map[i].to]) {
        continue;
      }

      if (!jdocs[map[i].to].children) jdocs[map[i].to].children = {};
      jdocs[map[i].to].children[jdocs[map[i].from][field]] = jdocs[map[i].from];
      delete jdocs[map[i].from];
    }

    const sortJdocs = function (obj) {
      const data = [];
      const sorted = {};

      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          data.push(obj[key]);
        }
      }

      // sort by depth desc
      data.sort(function (a, b) {
        return a._w - b._w;
      });

      const dataLength = data.length;
      for (let i = 0, len = dataLength; i < len; i++) {
        sorted[data[i]._id] = obj[data[i]._id];

        if (obj[data[i]._id] && obj[data[i]._id].children) {
          obj[data[i]._id].children = sortJdocs(obj[data[i]._id].children);
        }
      }

      return sorted;
    };

    sortJdocs(jdocs);

    return jdocs;
  });

  // --- Array Tree ---------------------------------------------------------------

  schema.static('ToArrayTree', function (docs, fields) {
    const jdocs = {};
    const map = [];
    let maxDepth = 0;

    for (let i = 0, len = docs.length; i < len; i++) {
      // docs.pop().toObject({virtuals: true});
      const el = docs[i].toObject({ virtuals: true });
      // var el = docs[i];

      if (el.parentId) {
        map[i] = {
          index: i,
          from: el[field].toString(),
          to: el.parentId.toString(),
          depth: el.depth,
        };

        if (el.depth > maxDepth) {
          maxDepth = el.depth;
        }
      }
      // filter selected fields
      if (fields) {
        const selected = {};
        for (const j in fields) {
          if (fields[j] && typeof el[j] !== 'undefined') {
            selected[j] = el[j];
          }
        }
        jdocs[el[field].toString()] = selected;
      } else {
        jdocs[el[field].toString()] = el;
      }
    }

    // sort by depth desc
    map.sort(function (a, b) {
      const res = b.depth - a.depth;
      return res === 0 ? a.index - b.index : res;
    });

    const results = [];
    for (const i in map) {
      if (!(map[i].to in jdocs)) {
        continue;
      }

      if (!jdocs[map[i].to].children) {
        jdocs[map[i].to].children = [];
      }

      jdocs[map[i].to].children.push(jdocs[map[i].from]);
      jdocs[map[i].to].children.sort(function (a, b) {
        return a._w - b._w;
      });

      delete jdocs[map[i].from];
    }

    for (const i in jdocs) {
      results.push(jdocs[i]);
    }

    return results;
  });

  // --- Build tree -------------------------------------------------------------

  schema.static('GetTree', async function (condition, query = {}) {
    const doc = await this.findOne(condition).exec();
    return doc.getTree(query);
  });

  schema.static('GetFullTree', async function () {
    const docs = await this.find().sort({ path: 1, _w: 1 }).exec();
    return this.ToTree(docs);
  });

  // --- Get Array Tree ---------------------------------------------------------------------
  schema.static('GetArrayTree', async function (condition, query = {}) {
    const doc = await this.findOne(condition);
    return doc.getArrayTree(query);
  });

  schema.static('GetFullArrayTree', async function () {
    const docs = await this.find().sort({ path: 1, _w: 1 }).exec();
    return this.ToArrayTree(docs);
  });

  // --- Building materialized paths --------------------------------------------------------
  schema.static('Building', function (prepare, callback) {
    if (typeof prepare === 'function') {
      callback = prepare;
      prepare = null;
    }

    const self = this;
    const builder = function () {
      const updateChildren = function (pDocs, cbFinish) {
        async.mapLimit(
          pDocs,
          mapLimit,
          function (parent, cbNext) {
            // update children
            self.updateMany(
              {
                parentId: parent[field],
              },
              {
                path:
                  (parent.path ? parent.path : '') +
                  separator +
                  parent[field].toString(),
                _w: 0,
              },
              function () {
                // after updated
                self
                  .find({ parentId: parent[field] })
                  .exec(function (err, docs) {
                    if (docs.length === 0) return cbNext(null);

                    updateChildren(docs, function () {
                      cbNext(null);
                    });
                  });
              },
            );
          },
          function () {
            cbFinish(null);
          },
        );
      };

      self.find({ parentId: null }).exec(function (err, docs) {
        // clear path
        self.updateMany(
          {
            parentId: null,
          },
          {
            path: '',
            _w: 0,
          },
          function () {
            updateChildren(docs, function () {
              callback();
            });
          },
        );
      });
    };

    if (!prepare) {
      builder();
      return;
    }

    if (prepare.remove) {
      self.update(
        {},
        {
          $unset: prepare.remove,
        },
        {
          multi: true,
        },
        function () {
          builder();
        },
      );
    }
  });
};

module.exports = materialized;
