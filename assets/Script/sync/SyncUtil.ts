/**
 * 网络同步基础工具
 * 1. 属性复制相关
 *  基础属性复制
 *  数组复制
 *  对象复制
 */

/** 属性变化回调 */
export type ReplicateNotify = (target: any, key: string, value: any) => boolean;

/**
 * 属性同步选项
 */
export interface RplicatedOption {
    /** 属性同步条件 */
    Condiction: number;
    /** 同步回调 */
    Notify: ReplicateNotify;
}

export const REPLICATE_OBJECT_INDEX = "__repObj__";

function getReplicateObject(target: any, autoCreator: boolean = false): ReplicateObject {
    let ret: ReplicateObject = target[REPLICATE_OBJECT_INDEX];
    if (!ret && autoCreator) {
        target[REPLICATE_OBJECT_INDEX] = new ReplicateObject();
    }
    return ret;
}

/**
 * 属性同步装饰器
 * @param option 同步选项
 */
export function replicated(option?: RplicatedOption) {
    // 真正的装饰器
    return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
        let oldSet = descriptor.set;
        descriptor.set = (v: any) => {
            let repObj = getReplicateObject(target, true);
            // 标记属性发生变化
            repObj.propertyChanged(propertyKey, v);
            if (oldSet) {
                oldSet(v);
            }
        }
        let oldGet = descriptor.get;
        if (!oldGet) {
            descriptor.get = () => {
                let repObj = getReplicateObject(target, true);
                repObj.getProperty(propertyKey);
            }
        }
    };
}

/**
 * 一个属性的变化信息
 * changed : 是否有发生过变化
 * version : 该属性的最新版本号
 * data : 该属性的最新数据
 * 
 * 当属性为 :
 * 基础类型 - data为最新的值
 * 结构对象类型 - data为ReplicateObject
 * 数组类型 - data为整个数组对象（每次变化都会全量更新数组）
 * 节点类型 - data为节点的网络唯一ID
 * 组件类型 - data为组件的网络唯一ID
 */
interface ReplicateProperty {
    changed: boolean;
    version: number;
    data: any;
}

/**
 * 负责一个类中所有被标记为replicate的属性的复制和赋值
 * 收集所有增量的变化，并标记版本号
 */
class ReplicateObject {
    private static IsServer: boolean = false;
    /** 最后一个有数据变化的版本号 */
    private lastVersion: number = 0;
    /** 所有发生过变化的数据，属性名 : 变化参数 */
    private dataMap: Map<string, ReplicateProperty> = new Map<string, ReplicateProperty>();
    /** 自上次同步后有无属性发生过变化 */
    private hasNewChange: boolean = false;
    /** outter的ReplicateObject */
    private outter: ReplicateObject | null = null;
    /** 在outter中的属性名 */
    private outterKey: string = "";

    public genProperty(outObject: Object, key: string, data: any) {
        Object.defineProperty(outObject, key, data);
    }

    /**
     * 当一个属性被重新赋值时回调，即 target.key = v时
     * 1. 对比数值是否有发生变化，有则更新dataMap
     * 2. 如果要赋值的是一个可复制对象 v intanceof Rep，设置当前target为v的outter
     * 3. 当属性变化时存在outer
     * 
     * PS: 初始化赋值是否可以跳过？是否可以存着多个outer？
     * @param key 
     * @param v 
     */
    public propertyChanged(key: string, v?: any): void {
        let repPro = this.dataMap.get(key);
        if (repPro) {
            if (v === repPro.data) {
                // 实际的数值并没有发生改变
                return;
            }
            repPro.changed = true;
            if (!(v === undefined && repPro.data instanceof ReplicateObject)) {
                repPro.data = v;
            }
        } else {
            repPro = { version: 0, data: v, changed: true };
            this.dataMap.set(key, v);
        }

        // 如果设置了新的对象成员
        if (repPro.data instanceof ReplicateObject) {
            repPro.data.setOutter(this, key);
        }

        // 如果有outter，需要通知，但只通知一次就够了
        if (!this.hasNewChange && this.outter) {
            this.outter.propertyChanged(this.outterKey);
        }

        this.hasNewChange = true;
    }

    public getProperty(key: string): any {
        let repPro = this.dataMap.get(key);
        return repPro ? repPro.data : repPro;
    }

    public setOutter(outter: ReplicateObject, key: string) {
        this.outter = outter;
        this.outterKey = key;
    }

    /**
     * 生成从fromVersion到toVersion的增量差异包，如果新的变化产生，则最新的变化会标记为toVersion
     * @param fromVersion 
     * @param toVersion 必须是最新的版本号
     */
    public genDiff(fromVersion: number, toVersion: number): any {
        if (toVersion <= fromVersion) {
            return false;
        }

        // 没有差异
        if (fromVersion > this.lastVersion && !this.hasNewChange) {
            return false;
        }

        let outObject = {};
        for (let [key, property] of this.dataMap) {
            if (property.changed) {
                property.changed = false;
                property.version = toVersion;
            } else if (property.version < fromVersion) {
                continue;
            }
            if (property.data instanceof ReplicateObject) {
                let diff = property.data.genDiff(fromVersion, toVersion);
                if (diff != false) {
                    this.genProperty(outObject, key, diff);
                }
            } else {
                this.genProperty(outObject, key, property.data);
            }
        }

        return outObject;
    }

    /**
     * 应用差异数据，更新到最新状态
     * @param diff 
     */
    public applyDiff(target: any, diff: any) {
        for (let propertyName in diff) {
            if (diff[propertyName] instanceof Object) {
                this.applyDiff(target[propertyName], diff[propertyName]);
            } else {
                target[propertyName] = diff[propertyName];
            }
        }
    }
}
