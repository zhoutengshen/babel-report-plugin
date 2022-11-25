const babelTemplate = require("@babel/template")
const babelTypes = require("@babel/types")
const importModule = require("@babel/helper-module-imports")

const handleReg = /handle.+/
module.exports = function () {
    return {
        /**@type{import('@babel/traverse').TraverseOptions*/
        visitor: {
            Program: {
                enter(path, state) {
                    // TODO: 没有配置 全局 $report 的时候，动态import 模块进来
                    const { globalReportName, moduleReportFilePath } = state.opts
                    if (!globalReportName && moduleReportFilePath) {
                        // 找一下，看看有没有导入过这个模块
                        path.traverse({
                            ImportDeclaration(importModulePath) {
                                let importModuleName = importModulePath.node.source.value
                                // TODO: 暂时写死，后续配置对比webpack 的别名和moduleReportFilePath比对
                                if (importModuleName === "@report") {
                                    const importSpecifier = importModulePath.get("specifiers.0")
                                    if (babelTypes.isImportDefaultSpecifier(importSpecifier)) {
                                        state.reportFuncId = importSpecifier.toString();
                                        importModulePath.stop()
                                    }
                                }
                            }
                        })
                        // 代码中没有 import 这个模块，那么插入该模块
                        if (!state.reportFuncId) {
                            state.reportFuncId = importModule.addDefault(path, moduleReportFilePath, {
                                nameHint: path.scope.generateUid('report')
                            }).name
                        }
                    } else {
                        // 使用全局 $report
                        state.reportFuncId = `this.${globalReportName}`
                    }
                }
            },
            ObjectMethod(path, state) {
                const handleFuncName = path.node.key.name
                const reportFuncId = state.reportFuncId
                if (handleReg.test(handleFuncName) && reportFuncId) {
                    const getParamsObj = (params = []) => {
                        const withPlaceholder = (key) => {
                            return `{{${key}}}`
                        }
                        return params.reduce((pre, next) => {
                            if (babelTypes.isIdentifier(next)) {
                                pre[next.name] = withPlaceholder(next.name)
                            } else if (babelTypes.isAssignmentPattern(next) && babelTypes.isIdentifier(next.left)) {
                                const key = next.left.name
                                pre[key] = withPlaceholder(key)
                            } else if (babelTypes.isRestElement(next) && babelTypes.isIdentifier(next.argument)) {
                                pre[next.argument.name] = withPlaceholder(next.argument)
                            }
                            return pre
                        }, { method: `${handleFuncName}` })
                    }
                    const params = JSON.stringify(getParamsObj(path.node.params)).replace(/("{{)|(}}")/g, "")
                    const reportCodeAstStr = `
                        ${reportFuncId}(${params})
                    `
                    const reportCodeAsts = babelTemplate.statements(reportCodeAstStr)()
                    path.node.body.body.unshift(...reportCodeAsts)
                }
            }
        }
    }
}