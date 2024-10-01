class TPromise{
  /**
   * @private
   * @type {'pending'| 'fulfilled'| 'rejected'}
   */
  status: string

  /**
   * resolved 传递的值
   * @private
   */
  value: any

  /**
   * rejected 拦截的错误
   * @private
   */
  reason: Object

  /**
   * 成功回调
   * @private
   */
  onFulfilledCallbacks: Function[]

  /**
   * 失败回调
   * @private
   */
  onRejectedCallbacks: Function[]

  /**
   * 构造函数，初始化 status以及回调
   * @param executor function
   */
  constructor(executor: Function) {
    const that = this
    this.status = 'pending'
    this.onFulfilledCallbacks = []
    this.onRejectedCallbacks = []

    if(typeof executor !== 'function'){
      throw TypeError('executor must be a Function')
    }

    function resolve(value) {
      if(that.status === 'pending') {
        that.status = 'fulfilled'
        that.value = value
        that.onFulfilledCallbacks.forEach(cb => {
          this.isFunc(cb) && cb(value)
        })
      }
    }

    function reject(reason) {
      if(that.status === 'pending'){
        that.status = 'rejected'
        that.reason = reason
        that.onRejectedCallbacks.forEach(cb => {
          this.isFunc(cb) && cb(reason)
        })
      }
    }

    try {
      executor.call(that, resolve, reject)
    } catch (e) {
      reject(e)
    }
  }

  /**
   * then函数
   * @param onFulfilled 
   * @param onRejected 
   */
  then(onFulfilled, onRejected) {
    const that = this
    // 不是函数的回调直接将value 或 reason 持续地向下传递
    onFulfilled = this.isFunc(onFulfilled) ? onFulfilled : (value) => value
    onRejected = this.isFunc(onRejected) ? onRejected : (reason) => {
      throw reason
    }
    // 由上一个的 promise 状态来决定新的 promise 是否立即调用
    const promise = new TPromise(function(resolve, reject) {

      function fulfilledCallback(value) {
        queueMicrotask(() => {
          // 此处的逻辑就是微任务      queueMircrotask 将任务插入到微任务队列
          try {
            const result = onFulfilled(value)
            this.resolvePromise(promise, result, resolve, reject)
          } catch (e) {
            reject(e)
          }
        })
      }

      function rejectedCallback(reason) {
        queueMicrotask(() => {
          try {
            const result = onRejected(reason)
            this.resolvePromise(promise, result, resolve, reject)
          } catch (e) {
            reject(e)
          }
        })
      }

      switch(that.status) {
        case 'fulfilled':
          fulfilledCallback(that.value)
          break
        case 'rejected':
          rejectedCallback(that.reason)
          break
        default: {
          // pending状态，还没有进微任务队列，现放入回调数组
          // 待 pending 状态改变后再进入 queueMicrotask 排队
          // 发布订阅模式
          that.onFulfilledCallbacks.push(fulfilledCallback)
          that.onRejectedCallbacks.push(rejectedCallback)
        }
      }
    })
    return promise
  }


  /**
   * 工具函数，判断是否为 Func
   * @param fn 
   * 静态 resolve 方法
   * @param value 
   * @returns 
   */
  isFunc(fn) {
    return typeof fn === 'function'
  }

  /**
   * 工具函数，判断是否为对象
   * @param obj 
   * @returns 
   */
  isObject(obj) {
    return Object.prototype.toString.call(obj) === '[Object Object]'
  }

  /**
   * 工具函数， 判断 onFulfilled 和 onRejected 的回调是不是不传递，或者不是函数类型
   * @param promise 
   * @param data onFulfilled or onRejected 的回调函数
   * @param resolve 
   * @param reject 
   */
  resolvePromise(promise, data, resolve, reject) {
    if (data === promise) {
      return reject(new Error('禁止循环引用'))
    }
    // 多次调用resolve 或者reject 以第一次为主，忽略后面的调用
    let called = false
    if((this.isObject(data) && data !== null) || this.isFunc(data)) {
      try {
        const then = data.then
        if(this.isFunc(then)) {
          then.call(data, (value) => {
            if(called){
              return
            }
            called = true
            // 递归检查，防止 value 是一个 PromiseLike， Promise.resolve中的嵌套 thenable 在这里处理
            this.resolvePromise(promise, value, resolve, reject)
          }, (reason) => {
            if(called)return
            called = true
            reject(reason)
          })
        }else {
          resolve(data)
        }
      } catch (e) {
        if(called)return
        called = true
        reject(this.reason)
      }
    }else{
      resolve(data)
    }
  }

  /**
   * 静态 resolve 方法
   * @param value 
   * @returns 
   */
  static resolve(value) {
    if(value instanceof TPromise){
      return value
    }
    return new TPromise((resolve) => {
      resolve(value)
    })
  }

  /**
   * 静态 reject方法
   * @param reason 
   * @returns 
   */
  static reject(reason) {
    return new TPromise(reject => {
      reject(reason)
    })
  }

  /**
   * finally 方法
   * @param onFinally
   * @returns 
   */
  finally(onFinally) {
    return this.then(
      value => TPromise.resolve(onFinally()).then(()=>value, newReason => {
        throw newReason
      }), 
      (reason) => TPromise.resolve(onFinally()).then(()=>{
        throw reason
      }, (newReason) => {
        throw newReason
      })
    )
  }

  /**
   * 静态 TPromise.all
   * @param values 
   */
  static all(values) {
    if(!isIterator(values)) {
      throw new TypeError('values must be an iterator object.')
    }
    return new TPromise((resolve, reject) => {
      const results: any[] = []
      let count = 0
      let index = 0
      for (const value of values) {
        let resultIndex = index
        index ++
        const p = TPromise.resolve(value).then(value => {
          results[resultIndex] = value
          count ++
          if(count === index){
            resolve(results)
          }
        }, reason => {
          reject(reason)
        })
      }
      if(index === 0){
        reject(results)
      }
    })
  }

  static any(values){
    if(!isIterator(values)){
      throw new TypeError('values must be iterator object.')
    }
    return new TPromise((resolve, reject) => {
      let results: any[] = []
      let count = 0
      let index = 0
      for(const value of values) {
        let resultIndex = index
        index ++
        TPromise.resolve(value).then(value => {
          resolve(value)
        }, reason => {
          results[resultIndex] = reason
          count ++
          if(count === index){
            reject(results)
          }
        })
      }
      if(index === 0){
        reject(results)
      }
    })
  }
}


/**
 * 工具函数，判断是否为可迭代对象
 */
function isIterator( values){
  return typeof values[Symbol.iterator] === 'function'
}