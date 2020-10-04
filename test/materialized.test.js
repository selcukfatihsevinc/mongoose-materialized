/* eslint-disable guard-for-in */
/* eslint-disable no-shadow */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-unused-vars */
/* eslint-disable no-restricted-syntax */
const util = require('util');
const assert = require('assert');
const should = require('should');
const async = require('async');
const db = require('mongoose');
const materialized = require('../lib/materialized');

const { Schema } = db;
const { ObjectId } = Schema;

db.connect(
  process.env.MONGO_DB_URI || 'mongodb://localhost/mongoose-materialized',
  { useNewUrlParser: true, useUnifiedTopology: true },
);

describe('Materialized test', () => {
  // schema
  const treeSchema = new Schema({
    name: 'string',
    count: 'number',
    treeRef: { type: ObjectId, ref: 'tree' },
  });

  treeSchema.plugin(materialized);
  const TreeModel = db.model('tree', treeSchema, 'tree');

  let RootId = null;
  let lvl1Id = null;
  let lvl1Id2 = null;
  let lvl2Id = null;

  describe('#insert', () => {
    it('should insert main element, without parentId', (done) => {
      const instance = new TreeModel({
        name: '#0, parent: null, lvl: 0',
        count: 0,
        parentId: null,
      });

      instance.save((err, doc) => {
        RootId = doc._id;
        assert.strictEqual(err, null);
        assert.strictEqual(doc.path, '');
        assert.strictEqual(doc.parentId, null);
        assert.strictEqual(doc.depth, 0);
        done();
      });
    });

    it('should insert 1 level 1st child element', (done) => {
      const instance = new TreeModel({
        name: '#1, parent: #0, lvl: 1',
        count: 1,
        parentId: RootId,
      });

      instance.save((err, doc) => {
        assert.strictEqual(err, null);
        assert.strictEqual(doc.count, 1);
        assert.strictEqual(doc.parentId, RootId);
        assert.strictEqual(doc.path, `,${RootId}`);
        assert.strictEqual(doc.depth, 1);
        lvl1Id = doc._id;
        done();
      });
    });

    it('should insert 1 level 2nd child element', (done) => {
      const instance = new TreeModel({
        name: '#2, parent: #0, lvl: 1',
        count: 5,
        parentId: RootId,
      });

      instance.save((err, doc) => {
        assert.strictEqual(err, null);
        assert.strictEqual(doc.count, 5);
        assert.strictEqual(doc.parentId, RootId);
        assert.strictEqual(doc.path, `,${RootId}`);
        assert.strictEqual(doc.depth, 1);
        lvl1Id2 = doc._id;
        done();
      });
    });

    it('should insert 2 level 1st child element', (done) => {
      const instance = new TreeModel({
        name: '#3, parent: #1, lvl: 2',
        count: 3,
        parentId: lvl1Id,
      });
      instance.save((err, doc) => {
        assert.strictEqual(err, null);
        assert.strictEqual(doc.count, 3);
        assert.strictEqual(doc.parentId, lvl1Id);
        assert.strictEqual(doc.path, `,${RootId},${lvl1Id}`);
        assert.strictEqual(doc.depth, 2);
        done();
      });
    });

    it('should insert 2 level 2nd child element', (done) => {
      const instance = new TreeModel({
        name: '#4, parent: #1, lvl: 2',
        count: 2,
        parentId: lvl1Id,
      });

      instance.save((err, doc) => {
        assert.strictEqual(err, null);
        assert.strictEqual(doc.count, 2);
        assert.strictEqual(doc.parentId, lvl1Id);
        assert.strictEqual(doc.path, `,${RootId},${lvl1Id}`);
        assert.strictEqual(doc.depth, 2);
        lvl2Id = doc._id;
        done();
      });
    });

    it('should insert element for non existing parent', (done) => {
      const instance = new TreeModel({
        name: 'child element without parent',
        count: 6,
        parentId: db.Types.ObjectId(),
      });

      instance.save((err, doc) => {
        assert.notEqual(err, null);
        done();
      });
    });
  });

  describe('#query', () => {
    it('should query root data', (done) => {
      TreeModel.findOne({ parentId: null }).exec((err, doc) => {
        assert.strictEqual(err, null);
        assert.strictEqual(doc.count, 0);
        assert.strictEqual(doc._id.toString(), RootId.toString());
        assert.strictEqual(doc.depth, 0);
        done();
      });
    });

    it('should query getParent ', (done) => {
      TreeModel.findById(lvl2Id).exec(async (err, doc) => {
        assert.strictEqual(err, null);
        const doc2 = await doc.getParent();
        assert.strictEqual(doc2._id.toString(), doc.parentId.toString());
        done();
      });
    });

    it('should query getDescendants', (done) => {
      TreeModel.findOne({ parentId: null }).exec(async (err, rdoc) => {
        assert.equal(err, null);
        const docs = await rdoc.getDescendants();
        assert.strictEqual(docs.length, 4);
        assert.strictEqual(docs[0].parentId.toString(), rdoc._id.toString());
        done();
      });
    });

    it('should query getDescendants with pagination', (done) => {
      TreeModel.findOne({ parentId: null }).exec(async (err, rdoc) => {
        assert.equal(err, null);
        const docs = await rdoc.getDescendants({ limit: 2, skip: 1 });
        assert.strictEqual(docs.length, 2);
        assert.strictEqual(docs[0].parentId.toString(), rdoc._id.toString());
        done();
      });
    });

    it('should query getChildren with promise', (done) => {
      TreeModel.findOne({ parentId: null }).exec(async (err, rdoc) => {
        assert.equal(err, null);
        const docs = await rdoc.getChildren();
        assert.strictEqual(docs.length, 4);
        assert.strictEqual(docs[0].parentId.toString(), rdoc._id.toString());
        done();
      });
    });

    it('should query sub getDescendants', (done) => {
      TreeModel.findOne({ _id: lvl1Id }).exec(async (err, rdoc) => {
        assert.equal(err, null);
        const docs = await rdoc.getDescendants();

        assert.strictEqual(docs.length, 2);
        assert.strictEqual(docs[0].parentId.toString(), rdoc._id.toString());
        done();
      });
    });

    it('should query getAncestors', (done) => {
      TreeModel.findById({ _id: lvl2Id }).exec(async (err, doc) => {
        assert.strictEqual(err, null);
        const parents = await doc.getAncestors();
        assert.strictEqual(parents.length, 2);
        done();
      });
    });

    it('should get children static', async () => {
      const children = await TreeModel.GetChildren(RootId);
      assert.strictEqual(children.length, 4);
    });

    it('should get children static with condition', async () => {
      const children = await TreeModel.GetChildren(RootId, {
        condition: { count: 1 },
      });

      assert.strictEqual(children.length, 1);
      assert.strictEqual(children[0].count, 1);
    });

    it('should get roots', async () => {
      const roots = await TreeModel.GetRoots();
      assert.strictEqual(roots.length, 1);
      assert.strictEqual(roots[0].parentId, null);
    });

    it('should get tree', (done) => {
      TreeModel.findOne({ parentId: null }, async (err, root) => {
        assert.strictEqual(err, null);
        const childs = await root.getChildren();
        assert.notStrictEqual(childs.length, 0);

        const tree = TreeModel.ToTree(childs);
        assert.strictEqual(Object.keys(tree).length, 2);
        for (const i in tree) {
          if (tree[i].name === '#1, parent: #0, lvl: 1') {
            assert.strictEqual(Object.keys(tree[i].children).length, 2);
          }
        }
        done();
      });
    });

    it('should get tree, respect sorting (_w)', (done) => {
      const data = {};
      async.waterfall(
        [
          (cb) => {
            TreeModel.create({ name: 'A' }, (err, catA) => {
              data.catA = catA;
              cb(err, catA);
            });
          },
          (catA, cb) => {
            TreeModel.create(
              { parentId: catA._id, name: 'A1', _w: 3 },
              (err, catA1) => {
                data.catA1 = catA1;
                cb(err, catA);
              },
            );
          },
          (catA, cb) => {
            TreeModel.create(
              { parentId: catA._id, name: 'A2', _w: 2 },
              (err, catA2) => {
                data.catA2 = catA2;
                cb(err, catA);
              },
            );
          },
          (catA, cb) => {
            TreeModel.create(
              { parentId: catA._id, name: 'A3', _w: 1 },
              (err, catA3) => {
                data.catA3 = catA3;
                cb(err);
              },
            );
          },
        ],
        (err, results) => {
          TreeModel.findOne({ _id: data.catA._id }, async (err, root) => {
            assert.strictEqual(err, null);
            const tree = await root.getTree();
            const keysList = Object.keys(tree[data.catA._id].children);
            assert.strictEqual(keysList[0], data.catA3._id.toString());
            assert.strictEqual(keysList[1], data.catA2._id.toString());
            assert.strictEqual(keysList[2], data.catA1._id.toString());
            done();
          });
        },
      );
    });

    it('should get array tree, populate fields', (done) => {
      const data = {};
      async.waterfall(
        [
          (cb) => {
            TreeModel.create({ name: 'Ax' }, (err, catA) => {
              data.catA = catA;
              cb(err, catA);
            });
          },
          (catA, cb) => {
            TreeModel.create(
              { parentId: catA._id, name: 'Ax1', treeRef: catA._id },
              (err, catA1) => {
                data.catA1 = catA1;
                cb(err, catA1);
              },
            );
          },
          (catA1, cb) => {
            TreeModel.create(
              { parentId: catA1._id, name: 'Ax2', treeRef: data.catA._id },
              (err, catA2) => {
                data.catA2 = catA2;
                cb(err, catA2);
              },
            );
          },
        ],
        (err, results) => {
          TreeModel.findOne({ _id: data.catA._id }, async (err, root) => {
            assert.strictEqual(err, null);
            const tree = await root.getArrayTree({
              populate: [{ path: 'treeRef', select: '_id name' }],
            });

            assert.strictEqual(tree[0].name, 'Ax');
            assert.strictEqual(tree[0].children[0].treeRef.name, 'Ax');
            assert.strictEqual(tree[0].children[0].treeRef.path, undefined);
            assert.strictEqual(
              tree[0].children[0].children[0].treeRef.name,
              'Ax',
            );
            assert.strictEqual(
              tree[0].children[0].children[0].treeRef.path,
              undefined,
            );
            done();
          });
        },
      );
    });

    it('should get array tree', (done) => {
      TreeModel.findOne({ parentId: null }, async (err, root) => {
        assert.strictEqual(err, null);
        const childs = await root.getChildren();
        assert.notStrictEqual(childs.length, 0);

        const tree = TreeModel.ToArrayTree(childs);
        assert.strictEqual(tree.length, 2);
        for (const i in tree) {
          if (tree[i].name === '#1, parent: #0, lvl: 1') {
            assert.strictEqual(tree[i].children.length, 2);
          }
        }
        done();
      });
    });

    it('should get array tree, respect sorting (_w)', (done) => {
      const data = {};
      async.waterfall(
        [
          (cb) => {
            TreeModel.create({ name: 'A' }, (err, catA) => {
              data.catA = catA;
              cb(err, catA);
            });
          },
          (catA, cb) => {
            TreeModel.create(
              { parentId: catA._id, name: 'A1', _w: 3 },
              (err, catA1) => {
                data.catA1 = catA1;
                cb(err, catA);
              },
            );
          },
          (catA, cb) => {
            TreeModel.create(
              { parentId: catA._id, name: 'A2', _w: 2 },
              (err, catA2) => {
                data.catA2 = catA2;
                cb(err, catA);
              },
            );
          },
          (catA, cb) => {
            TreeModel.create(
              { parentId: catA._id, name: 'A3', _w: 1 },
              (err, catA3) => {
                data.catA3 = catA3;
                cb(err);
              },
            );
          },
        ],
        (err, results) => {
          TreeModel.findOne({ _id: data.catA._id }, async (err, root) => {
            assert.strictEqual(err, null);
            const tree = await root.getArrayTree();
            assert.strictEqual(tree[0].children[0].name, 'A3');
            assert.strictEqual(tree[0].children[1].name, 'A2');
            assert.strictEqual(tree[0].children[2].name, 'A1');
            done();
          });
        },
      );
    });

    it('should get tree with root', (done) => {
      TreeModel.findOne({ parentId: null }, async (err, root) => {
        assert.strictEqual(err, null);
        const tree = await root.getTree();
        assert.strictEqual(tree[root._id.toString()].name, root.name);
        assert.strictEqual(tree[root._id.toString()].parentId, null);
        const childKeys = Object.keys(tree[root._id.toString()].children);
        assert.strictEqual(childKeys.length, 2);
        assert.strictEqual(
          tree[root._id.toString()].children[lvl1Id]._id.toString(),
          lvl1Id.toString(),
        ); // 1st child
        assert.strictEqual(
          tree[root._id.toString()].children[lvl1Id2]._id.toString(),
          lvl1Id2.toString(),
        ); // 2nd child
        done();
      });
    });

    it('should get array tree with root', (done) => {
      TreeModel.findOne({ parentId: null }, async (err, root) => {
        assert.strictEqual(err, null);
        const tree = await root.getArrayTree();

        assert.strictEqual(tree[0].name, root.name);
        assert.strictEqual(tree[0].parentId, null);

        assert.strictEqual(tree[0].children.length, 2);
        assert.strictEqual(
          tree[0].children[0]._id.toString(),
          lvl1Id.toString(),
        ); // 1st child
        assert.strictEqual(
          tree[0].children[1]._id.toString(),
          lvl1Id2.toString(),
        ); // 2nd child
        done();
      });
    });

    it('should get tree with root static', async () => {
      const tree = await TreeModel.GetTree({ parentId: null });

      assert.strictEqual(tree[RootId.toString()].parentId, null);
      const childKeys = Object.keys(tree[RootId.toString()].children);
      assert.strictEqual(childKeys.length, 2);
      assert.strictEqual(
        tree[RootId.toString()].children[lvl1Id]._id.toString(),
        lvl1Id.toString(),
      ); // 1st child
      assert.strictEqual(
        tree[RootId.toString()].children[lvl1Id2]._id.toString(),
        lvl1Id2.toString(),
      ); // 2nd child
    });

    it('should get array tree with root static', async () => {
      const tree = await TreeModel.GetArrayTree({ parentId: null });

      assert.strictEqual(tree[0].parentId, null);
      assert.strictEqual(tree[0].children.length, 2);

      for (const i in tree[0].children) {
        assert.strictEqual(
          tree[0].children[i].parentId.toString(),
          tree[0]._id.toString(),
        );
      }
    });

    it('should get full tree', async () => {
      const tree = await TreeModel.GetFullTree();

      assert.strictEqual(tree[RootId.toString()].parentId, null);
      const childKeys = Object.keys(tree[RootId.toString()].children);
      assert.strictEqual(childKeys.length, 2);
      assert.strictEqual(
        tree[RootId.toString()].children[lvl1Id]._id.toString(),
        lvl1Id.toString(),
      ); // 1st child
      assert.strictEqual(
        tree[RootId.toString()].children[lvl1Id2]._id.toString(),
        lvl1Id2.toString(),
      ); // 2nd child
    });

    it('should get full array tree', async () => {
      const tree = await TreeModel.GetFullArrayTree();

      assert.strictEqual(tree[0].parentId, null);
      assert.strictEqual(tree[0].children.length, 2);

      for (const i in tree[0].children) {
        assert.strictEqual(
          tree[0].children[i].parentId.toString(),
          tree[0]._id.toString(),
        );
      }
    });
  });

  describe('#building', () => {
    const simpleSchema = new Schema({
      name: 'string',
      parentId: 'ObjectId',
    });
    const Simple = db.model('simple', simpleSchema, 'simple');

    const main = new Simple({ name: '#0', parentId: null });
    it('should populate collection for building', (done) => {
      main.save((err, root) => {
        const child1 = new Simple({ name: '#1', parentId: root._id });
        child1.save((err1, ch1) => {
          const child2 = new Simple({ name: '#2', parentId: ch1._id });
          child2.save((err2, ch2) => {
            const child3 = new Simple({ name: '#3', parentId: ch1._id });
            child3.save((err3, ch3) => {
              done();
            });
          });
        });
      });
    });

    const simple1Schema = new Schema({
      name: 'string',
      parentId: 'ObjectId',
    });
    simple1Schema.plugin(materialized);
    const Simple1 = db.model('simple1', simple1Schema, 'simple');

    it('should building hierarchic and check tree', (done) => {
      Simple1.Building(() => {
        Simple1.findOne({ parentId: null }).exec((err, root) => {
          assert.strictEqual(err, null);
          Simple1.findOne({ parentId: root._id }).exec(async (err, doc) => {
            assert.strictEqual(err, null);
            assert.strictEqual(doc.path, `,${root._id}`);
            const children = await doc.getChildren();
            assert.strictEqual(children.length, 2);
            assert.strictEqual(
              children[0].path,
              `${doc.path},${doc._id.toString()}`,
            );
            done();
          });
        });
      });
    });
  });

  describe('#tree-moving', () => {
    const catSchema = new Schema({
      name: 'string',
    });

    catSchema.plugin(materialized);
    const Cat = db.model('cat2', catSchema, 'cat2');

    let foodId = null;
    let vegaId = null;
    let tomatoId = null;
    let pepperId = null;

    // ---------------------------------------------------------

    it('should build simple category schema', (done) => {
      const food = new Cat({ name: 'Foods' });
      food.save(async (err, food) => {
        assert.strictEqual(err, null);
        foodId = food._id;

        const vega = await food.appendChild({ name: 'Vegetables' });
        vegaId = vega._id;

        const tomato = new Cat({ name: 'Tomato' });
        tomato.parentId = vegaId;
        tomato.save(async (err, tomato) => {
          assert.strictEqual(err, null);
          tomatoId = tomato._id;
          const pepper = await vega.appendChild({ name: 'pepper' });
          pepperId = pepper._id;
          done();
        });
      });
    });

    it('should remove item parent', (done) => {
      Cat.findById(vegaId, (err, vega) => {
        Object.assign(vega, { parentId: null });
        vega.save((err, vega) => {
          assert.strictEqual(err, null);

          Cat.findById(tomatoId, (err, tomato) => {
            assert.strictEqual(tomato.path, `,${vega._id.toString()}`);

            Cat.findById(pepperId, (err, pepper) => {
              assert.strictEqual(pepper.path, `,${vega._id.toString()}`);
              done();
            });
          });
        });
      });
    });

    it('should move root item to sub element', (done) => {
      Cat.findById(vegaId, (err, vega) => {
        Object.assign(vega, { parentId: foodId });
        vega.save((err, vega) => {
          assert.strictEqual(err, null);
          assert.strictEqual(vega.parentId, foodId);

          Cat.findById(tomatoId, (err, tomato) => {
            assert.strictEqual(
              tomato.path,
              `${vega.path},${vega._id.toString()}`,
            );

            Cat.findById(pepperId, (err, pepper) => {
              assert.strictEqual(
                pepper.path,
                `${vega.path},${vega._id.toString()}`,
              );
              done();
            });
          });
        });
      });
    });

    it('should move item with all children', (done) => {
      const data = {};
      async.waterfall(
        [
          (cb) => {
            TreeModel.create({ name: 'A' }, (err, catA) => {
              data.catA = catA;
              cb(err, catA);
            });
          },
          (catA, cb) => {
            TreeModel.create(
              { parentId: catA._id, name: 'A1', _w: 3 },
              (err, catA1) => {
                data.catA1 = catA1;
                cb(err, catA1);
              },
            );
          },
          (catA1, cb) => {
            TreeModel.create(
              { parentId: catA1._id, name: 'A2', _w: 2 },
              (err, catA2) => {
                data.catA2 = catA2;
                cb(err, catA2);
              },
            );
          },
          (catA2, cb) => {
            TreeModel.create(
              { parentId: catA2._id, name: 'A3', _w: 1 },
              (err, catA3) => {
                data.catA3 = catA3;
                cb(err);
              },
            );
          },
          (cb) => {
            TreeModel.create(
              { parentId: data.catA1._id, name: 'A2a' },
              (err, catA2a) => {
                data.catA2a = catA2a;
                cb(err);
              },
            );
          },
          (cb) => {
            TreeModel.create({ name: 'B' }, (err, catB) => {
              data.catB = catB;
              cb(err, data);
            });
          },
        ],
        (err, results) => {
          // move catA1 to B and check catA3
          data.catA1.parentId = data.catB._id;
          data.catA1.save((err, catA1) => {
            assert.strictEqual(catA1.parentId, data.catB._id);
            async.parallel(
              {
                catA2: (cb) => {
                  TreeModel.findById(data.catA2._id, (err, catA2) => {
                    cb(err, catA2);
                  });
                },
                catA2a: (cb) => {
                  TreeModel.findById(data.catA2a._id, (err, catA2a) => {
                    cb(err, catA2a);
                  });
                },
                catA3: (cb) => {
                  TreeModel.findById(data.catA3._id, (err, catA3) => {
                    cb(err, catA3);
                  });
                },
              },
              (err, getResults) => {
                assert.strictEqual(
                  getResults.catA2.path,
                  `,${data.catB._id},${data.catA1._id}`,
                );
                assert.strictEqual(
                  getResults.catA2a.path,
                  `,${data.catB._id},${data.catA1._id}`,
                );
                assert.strictEqual(
                  getResults.catA3.path,
                  `,${data.catB._id},${data.catA1._id},${data.catA2._id}`,
                );
                done();
              },
            );
          });
        },
      );
    });
  });

  describe('#checks', () => {
    it('should check IsRoot via id', async () => {
      const result = await TreeModel.IsRoot(RootId);
      assert.strictEqual(result, true);
    });

    it('should check IsRoot via doc', async () => {
      const root = await TreeModel.findOne({ _id: RootId });
      const result = await TreeModel.IsRoot(root);
      assert.strictEqual(result, true);
    });

    it('should check isRoot', async () => {
      const root = await TreeModel.findOne({ _id: RootId });
      const result = await root.isRoot();
      assert.strictEqual(result, true);
    });

    it('should check IsLeaf via id', async () => {
      const result = await TreeModel.IsLeaf(lvl2Id);
      assert.strictEqual(result, true);
    });

    it('should check IsLeaf via doc', async () => {
      const doc = await TreeModel.findOne({ _id: lvl2Id });
      const result = await TreeModel.IsLeaf(doc);
      assert.strictEqual(result, true);
    });

    it('should check isLeaf', async () => {
      const doc = await TreeModel.findOne({ _id: lvl2Id });
      const result = await doc.isLeaf();
      assert.strictEqual(result, true);
    });

    it('should check isParent via id', async () => {
      const doc = await TreeModel.findOne({ _id: lvl1Id });
      const result = await doc.isParent(RootId);
      assert.strictEqual(result, true);
    });

    it('should check isParent via doc', async () => {
      const root = await TreeModel.findOne({ _id: RootId });
      const doc = await TreeModel.findOne({ _id: lvl1Id });
      const result = await doc.isParent(root);
      assert.strictEqual(result, true);
    });

    it('should check isDescendant via id', async () => {
      const doc = await TreeModel.findOne({ _id: lvl1Id });
      const result = await doc.isDescendant(lvl2Id);
      assert.strictEqual(result, true);
    });

    it('should check isDescendant via doc', async () => {
      const doc1 = await TreeModel.findOne({ _id: lvl1Id });
      const doc2 = await TreeModel.findOne({ _id: lvl2Id });
      const result = await doc1.isDescendant(doc2);
      assert.strictEqual(result, true);
    });

    it('should check isSibling via id', async () => {
      const doc = await TreeModel.findOne({ _id: lvl1Id });
      const result = await doc.isSibling(lvl1Id2);
      assert.strictEqual(result, true);
    });

    it('should check isSibling via doc', async () => {
      const doc1 = await TreeModel.findOne({ _id: lvl1Id });
      const doc2 = await TreeModel.findOne({ _id: lvl1Id2 });
      const result = await doc1.isSibling(doc2);
      assert.strictEqual(result, true);
    });
  });

  describe('#clean', () => {
    it('should remove #1 item', (done) => {
      TreeModel.findById(lvl1Id, async (err, doc) => {
        assert.equal(err, null);
        await TreeModel.Remove({ _id: lvl1Id });

        TreeModel.findOne({ parentId: lvl1Id }).exec((err, child) => {
          assert.strictEqual(err, null);
          assert.strictEqual(child, null);
          done();
        });
      });
    });

    it('should drop database', async () => {
      await db.connection.dropDatabase();
    });
  });
});

describe('Alternative tests', () => {
  const novaSchema = new Schema({ id: 'number', name: 'string' });
  novaSchema.plugin(materialized, { field: 'id' });
  const NovaModel = db.model('nova', novaSchema, 'nova');

  let RootId = null;
  let lvl1Id = null;
  let lvl1Id2 = null;
  let lvl2Id = null;

  describe('#insert', () => {
    it('should insert main element, without parentId', (done) => {
      const instance = new NovaModel({
        id: 1,
        name: '#0, parent: null, lvl: 0',
        parentId: null,
      });

      instance.save((err, doc) => {
        RootId = doc.id;
        assert.strictEqual(err, null);
        assert.strictEqual(doc.id, 1);
        assert.strictEqual(doc.path, '');
        assert.strictEqual(doc.parentId, null);
        assert.strictEqual(doc.depth, 0);
        done();
      });
    });

    it('should insert 1 level 1st child element', (done) => {
      const instance = new NovaModel({
        id: 2,
        name: '#1, parent: #0, lvl: 1',
        parentId: RootId,
      });

      instance.save((err, doc) => {
        assert.strictEqual(err, null);
        assert.strictEqual(doc.id, 2);
        assert.strictEqual(doc.parentId, RootId);
        assert.strictEqual(doc.path, `,${RootId}`);
        assert.strictEqual(doc.depth, 1);
        lvl1Id = doc.id;
        done();
      });
    });

    it('should insert 1 level 2nd child element', (done) => {
      const instance = new NovaModel({
        id: 3,
        name: '#2, parent: #0, lvl: 1',
        parentId: RootId,
      });

      instance.save((err, doc) => {
        assert.strictEqual(err, null);
        assert.strictEqual(doc.id, 3);
        assert.strictEqual(doc.parentId, RootId);
        assert.strictEqual(doc.path, `,${RootId}`);
        assert.strictEqual(doc.depth, 1);
        lvl1Id2 = doc.id;
        done();
      });
    });

    it('should insert 2 level 1st child element', (done) => {
      const instance = new NovaModel({
        id: 4,
        name: '#3, parent: #1, lvl: 2',
        parentId: lvl1Id,
      });

      instance.save((err, doc) => {
        assert.strictEqual(err, null);
        assert.strictEqual(doc.id, 4);
        assert.strictEqual(doc.parentId, lvl1Id);
        assert.strictEqual(doc.path, `,${RootId},${lvl1Id}`);
        assert.strictEqual(doc.depth, 2);
        done();
      });
    });

    it('should insert 2 level 2nd child element', (done) => {
      const instance = new NovaModel({
        id: 5,
        name: '#4, parent: #1, lvl: 2',
        parentId: lvl1Id,
      });

      instance.save((err, doc) => {
        assert.strictEqual(err, null);
        assert.strictEqual(doc.id, 5);
        assert.strictEqual(doc.parentId, lvl1Id);
        assert.strictEqual(doc.path, `,${RootId},${lvl1Id}`);
        assert.strictEqual(doc.depth, 2);
        lvl2Id = doc.id;
        done();
      });
    });

    it('should insert element for non existing parent', (done) => {
      const instance = new NovaModel({
        id: 6,
        name: 'child element without parent',
        parentId: db.Types.ObjectId(),
      });

      instance.save((err, doc) => {
        assert.notEqual(err, null);
        done();
      });
    });
  });

  describe('#query', () => {
    it('should query root data', (done) => {
      NovaModel.findOne({ parentId: null }).exec((err, doc) => {
        assert.strictEqual(err, null);
        assert.strictEqual(doc.id.toString(), RootId.toString());
        assert.strictEqual(doc.depth, 0);
        done();
      });
    });

    it('should query getParent ', (done) => {
      NovaModel.findOne({ id: lvl2Id }).exec(async (err, doc) => {
        assert.strictEqual(err, null);
        const doc2 = await doc.getParent();
        assert.strictEqual(err, null);
        assert.strictEqual(doc2.id.toString(), doc.parentId.toString());
        done();
      });
    });

    it('should query getDescendants', (done) => {
      NovaModel.findOne({ parentId: null }).exec(async (err, rdoc) => {
        assert.equal(err, null);
        const docs = await rdoc.getDescendants();
        assert.strictEqual(err, null);
        assert.strictEqual(docs.length, 4);
        assert.strictEqual(docs[0].parentId.toString(), rdoc.id.toString());
        done();
      });
    });

    it('should query getDescendants with pagination', (done) => {
      NovaModel.findOne({ parentId: null }).exec(async (err, rdoc) => {
        assert.equal(err, null);
        const docs = await rdoc.getDescendants({ limit: 2, skip: 1 });
        assert.strictEqual(err, null);
        assert.strictEqual(docs.length, 2);
        assert.strictEqual(docs[0].parentId.toString(), rdoc.id.toString());
        done();
      });
    });

    it('should query getChildren with promise', (done) => {
      NovaModel.findOne({ parentId: null }).exec(async (err, rdoc) => {
        assert.equal(err, null);
        const docs = await rdoc.getChildren();
        assert.strictEqual(docs.length, 4);
        assert.strictEqual(docs[0].parentId.toString(), rdoc.id.toString());
        done();
      });
    });

    it('should query sub getDescendants', (done) => {
      NovaModel.findOne({ id: lvl1Id }).exec(async (err, rdoc) => {
        assert.equal(err, null);
        const docs = await rdoc.getDescendants();
        assert.strictEqual(err, null);
        assert.strictEqual(docs.length, 2);
        assert.strictEqual(docs[0].parentId.toString(), rdoc.id.toString());
        done();
      });
    });

    it('should query getAncestors', (done) => {
      NovaModel.findOne({ id: lvl2Id }).exec(async (err, doc) => {
        assert.strictEqual(err, null);
        const parents = await doc.getAncestors();
        assert.strictEqual(err, null);
        assert.strictEqual(parents.length, 2);
        done();
      });
    });

    it('should get children static', async () => {
      const children = await NovaModel.GetChildren(RootId);
      assert.strictEqual(children.length, 4);
    });

    it('should get children static with condition', async () => {
      const children = await NovaModel.GetChildren(RootId, {
        condition: { id: 4 },
      });

      assert.strictEqual(children.length, 1);
      assert.strictEqual(children[0].name, '#3, parent: #1, lvl: 2');
    });

    it('should get roots', async () => {
      const roots = await NovaModel.GetRoots();
      assert.strictEqual(roots.length, 1);
      assert.strictEqual(roots[0].parentId, null);
    });

    it('should get tree', (done) => {
      NovaModel.findOne({ parentId: null }, async (err, root) => {
        assert.strictEqual(err, null);
        const childs = await root.getChildren();

        assert.strictEqual(err, null);
        assert.notStrictEqual(childs.length, 0);

        const tree = NovaModel.ToTree(childs);
        assert.strictEqual(Object.keys(tree).length, 2);
        for (const i in tree) {
          if (tree[i].name === '#1, parent: #0, lvl: 1') {
            assert.strictEqual(Object.keys(tree[i].children).length, 2);
          }
        }
        done();
      });
    });

    it('should get array tree', (done) => {
      NovaModel.findOne({ parentId: null }, async (err, root) => {
        assert.strictEqual(err, null);
        const childs = await root.getChildren();

        assert.strictEqual(err, null);
        assert.notStrictEqual(childs.length, 0);

        const tree = NovaModel.ToArrayTree(childs);
        assert.strictEqual(tree.length, 2);
        for (const i in tree) {
          if (tree[i].name === '#1, parent: #0, lvl: 1') {
            assert.strictEqual(tree[i].children.length, 2);
          }
        }
        done();
      });
    });

    it('should get tree with root', (done) => {
      NovaModel.findOne({ parentId: null }, async (err, root) => {
        assert.strictEqual(err, null);
        const tree = await root.getTree();
        assert.strictEqual(err, null);
        assert.strictEqual(tree[root.id.toString()].name, root.name);
        assert.strictEqual(tree[root.id.toString()].parentId, null);
        const childKeys = Object.keys(tree[root.id.toString()].children);
        assert.strictEqual(childKeys.length, 2);
        assert.strictEqual(
          tree[root.id.toString()].children[lvl1Id].id.toString(),
          lvl1Id.toString(),
        ); // 1st child
        assert.strictEqual(
          tree[root.id.toString()].children[lvl1Id2].id.toString(),
          lvl1Id2.toString(),
        ); // 2nd child
        done();
      });
    });

    it('should get array tree with root', (done) => {
      NovaModel.findOne({ parentId: null }, async (err, root) => {
        assert.strictEqual(err, null);
        const tree = await root.getArrayTree();

        assert.strictEqual(err, null);
        assert.strictEqual(tree[0].name, root.name);
        assert.strictEqual(tree[0].parentId, null);

        assert.strictEqual(tree[0].children.length, 2);
        assert.strictEqual(
          tree[0].children[0].id.toString(),
          lvl1Id.toString(),
        ); // 1st child
        assert.strictEqual(
          tree[0].children[1].id.toString(),
          lvl1Id2.toString(),
        ); // 2nd child
        done();
      });
    });

    it('should get tree with root static', async () => {
      const tree = await NovaModel.GetTree({ parentId: null });
      assert.strictEqual(tree[RootId.toString()].parentId, null);
      const childKeys = Object.keys(tree[RootId.toString()].children);
      assert.strictEqual(childKeys.length, 2);
      assert.strictEqual(
        tree[RootId.toString()].children[lvl1Id].id.toString(),
        lvl1Id.toString(),
      ); // 1st child
      assert.strictEqual(
        tree[RootId.toString()].children[lvl1Id2].id.toString(),
        lvl1Id2.toString(),
      ); // 2nd child
    });

    it('should get array tree with root static', async () => {
      const tree = await NovaModel.GetArrayTree({ parentId: null });
      assert.strictEqual(tree[0].parentId, null);
      assert.strictEqual(tree[0].children.length, 2);

      for (const i in tree[0].children) {
        assert.strictEqual(
          tree[0].children[i].parentId.toString(),
          tree[0].id.toString(),
        );
      }
    });

    it('should get full tree', async () => {
      const tree = await NovaModel.GetFullTree();
      assert.strictEqual(tree[RootId.toString()].parentId, null);
      const childKeys = Object.keys(tree[RootId.toString()].children);
      assert.strictEqual(childKeys.length, 2);
      assert.strictEqual(
        tree[RootId.toString()].children[lvl1Id].id.toString(),
        lvl1Id.toString(),
      ); // 1st child
      assert.strictEqual(
        tree[RootId.toString()].children[lvl1Id2].id.toString(),
        lvl1Id2.toString(),
      ); // 2nd child
    });

    it('should get full array tree', async () => {
      const tree = await NovaModel.GetFullArrayTree();

      assert.strictEqual(tree[0].parentId, null);
      assert.strictEqual(tree[0].children.length, 2);

      for (const i in tree[0].children) {
        assert.strictEqual(
          tree[0].children[i].parentId.toString(),
          tree[0].id.toString(),
        );
      }
    });
  });

  describe('#clean', () => {
    it('should remove #1 item', (done) => {
      NovaModel.findOne({ id: lvl1Id }, async (err, doc) => {
        assert.equal(err, null);

        await NovaModel.Remove({ id: lvl1Id });

        NovaModel.findOne({ parentId: lvl1Id }).exec((err, child) => {
          assert.strictEqual(err, null);
          assert.strictEqual(child, null);
          done();
        });
      });
    });

    it('should drop database', async () => {
      await db.connection.dropDatabase();
    });
  });

  after((done) => {
    db.disconnect();
    done();
  });
});
