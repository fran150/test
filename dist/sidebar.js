define("text!qk-alchemy/components/layout/sidebar.component.html",[],function(){return'<quark-component>\r\n    <div class="sidebar" data-bind="onBind: init,\r\n                                    css: classes,\r\n                                    style: styles">\r\n        <span data-bind="css: resizerClass">\r\n            <button class="resizer" data-bind="onBind: initResizer,\r\n                              style: resizerStyle">\r\n               <span class="glyphicon glyphicon-option-vertical"></span>\r\n            </button>\r\n        </span>\r\n\r\n        <ul data-bind="style: { marginTop: model.marginTop }">\r\n            <!-- ko content -->\r\n            <!-- /ko -->\r\n        </ul>\r\n    </div>\r\n</quark-component>\r\n'}),define("qk-alchemy/lib/utils",["quark","knockout"],function(n,e){function t(){var e=this;this.findContainer=function(t,i){var o=t.$container,r=!1;if(n.isArray(i))for(var a=0;a<i.length;a++){var s=i[a];if(o instanceof s){r=!0;break}}else r=o instanceof i;if(r)return o;var c=t.$parentContext;return c?e.findContainer(c,i):void 0}}return new t}),define("text!qk-alchemy/components/layout.component.html",[],function(){return"<!-- quark-component -->\r\n    <!-- ko content -->\r\n    <!-- /ko -->\r\n<!-- /ko -->\r\n"}),define("qk-alchemy/components/layout.component",["quark","knockout","text!./layout.component.html"],function(n,e,t){function i(t,i,o){function r(){var e=s.sidebarSize(),t=s.minSidebarSize(),i=$(window).width()/2;n.isNumeric(t)&&t>0&&e<t&&s.sidebarSize(t),e<0&&s.sidebarSize(0),e>i&&s.sidebarSize(i)}function a(n){n?$(document).css("padding-top","50px"):$(document).css("padding-top","auto")}var s=this;this.hasNavbar=e.observable(!1),this.hasSidebar=e.observable(!1),this.hasSubmenu=e.observable(!1),n.parameters({sidebarSize:e.observable(90),containerSize:e.observable("md"),minSidebarSize:e.observable(20),containerFluid:e.observable(!0)},t,this),o.initComponent=function(){r(s.sidebarSize()),a(s.hasNavbar())};var c={sidebarSize:s.sidebarSize.subscribe(r),minSidebarSize:s.minSidebarSize.subscribe(r),hasNavbar:s.hasNavbar.subscribe(a)};i.dispose=function(){c.sidebarSize.dispose(),c.minSidebarSize.dispose(),c.hasNavbar.dispose()}}return n.component(i,t)}),define("qk-alchemy/components/layout/sidebar.component",["knockout","quark","text!./sidebar.component.html","../../lib/utils","../layout.component"],function(n,e,t,i,o){function r(t,r,a){function s(n){n?$(v).css("top","50px"):$(v).css("top","0px")}function c(n){n.pageX>z.sidebarSize()-h.resizerWidth()?$(k).show():$(k).hide()}function l(){h.resizing()||$(k).hide()}function u(n){y=n.offsetX,h.resizing(!0),z.sidebarSize(n.pageX+(h.resizerWidth()-y))}function d(n){h.resizing(!1)}function m(n){h.resizing()&&z.sidebarSize(n.pageX+(h.resizerWidth()-y))}var b,p,h=this,f=n.observable();this.resizing=n.observable(!1),e.parameters({resizerWidth:n.observable(10),marginTop:n.observable(0)},t,this);var v,k,y,z={sidebarSize:n.observable(),minSidebarSize:n.observable()},S={resizing:h.resizing.subscribe(function(n){n?($(window).on("mousemove",m),$(window).on("mouseup",d)):($(window).off("mousemove",m),$(window).off("mouseup",d))})};r.init=function(n,r,a){v=n;var u=i.findContainer(a,o.modelType);if(!u)throw new Error("The sidebar component must be used inside an al-layout component");z.sidebarSize=u.sidebarSize,z.minSidebarSize=u.minSidebarSize,b=u.hasNavbar,p=u.hasSidebar,f=u.containerSize,e.inject(t,z),u.hasSidebar(!0),h.sidebarSize=u.sidebarSize,h.minSidebarSize=u.minSidebarSize,S.hasNavbar=b.subscribe(function(n){s(n)}),$(v).on("mousemove",c),$(v).on("mouseleave",l),s(b())},r.initResizer=function(n){k=n,$(k).on("mousedown",u)},this.width=n.pureComputed(function(){return z.sidebarSize()+"px"}),r.styles=n.pureComputed(function(){var n={width:z.sidebarSize()+"px"};return n}),r.classes=n.pureComputed(function(){return"sidebar-col-"+f()}),r.resizerClass=n.pureComputed(function(){return"resizer-"+f()}),r.resizerStyle=n.pureComputed(function(){var n=h.resizerWidth(),e={fontSize:n};return e.left=h.sidebarSize()-n+"px",e}),r.dispose=function(){p(!1),S.resizing.dispose(),S.hasNavbar.dispose(),$(k).off("mousedown",u),$(v).off("mousemove",c),$(v).off("mouseleave",l),$(window).off("mousemove",m),$(window).off("mouseup",d)}}return e.component(r,t)}),define("text!qk-alchemy/components/layout/sidebar/imagebutton.component.html",[],function(){return'<quark-component>\r\n    <li class="text-center imagebutton" data-bind="onBind: init,\r\n                                                   click: click">\r\n        <a data-bind="click: click, attr: { href: url }">\r\n            <!-- ko if: model.icon -->\r\n                <div data-bind="css: model.icon"></div><br />\r\n            <!-- /ko -->\r\n            <small class="sidebar-text" data-bind="text: model.text,\r\n                                                   css: { notext: hideText }">\r\n            </small>\r\n        </a>\r\n    </li>\r\n</quark-component>\r\n'}),define("qk-alchemy/components/layout/sidebar/imagebutton.component",["knockout","quark","text!./imagebutton.component.html","../../../lib/utils","../sidebar.component"],function(n,e,t,i,o){function r(t,r){var a=this;e.parameters({pageName:n.observable(),pageParams:n.observable(),icon:n.observable("glyphicon glyphicon-star"),text:n.observable("Button"),hideTextAt:n.observable(85)},t,this);var s=n.observable();r.init=function(n,e,t){var r=i.findContainer(t,o.modelType);if(!r)throw new Error("This component must be used inside an al-layout-sidebar component");r.sidebarSize&&(s=r.sidebarSize)},r.hideText=n.pureComputed(function(){return s()<a.hideTextAt()}),r.click=function(){var n=r.url();n&&e.redirect(n)},r.url=n.pureComputed(function(){var n=a.pageName(),t=a.pageParams();return n?"#"+e.routing.hash(n,t):""})}return e.component(r,t)}),define("text!qk-alchemy/components/layout/sidebar/link.component.html",[],function(){return'<quark-component>\r\n    <li data-bind="onBind: init">\r\n        <ul>\r\n            <!-- ko hasContent: \'submenu\', virtual: true -->\r\n                <li class="option" style="position: relative" data-bind="click: model.toggle">\r\n                    <small style="position: absolute" class="glyphicon" data-bind="css: arrow">\r\n                    </small>\r\n\r\n                    <span class="line">\r\n                        <!-- ko if: model.iconFont -->\r\n                            <span data-bind="css: model.iconFont"></span>\r\n                        <!-- /ko -->\r\n\r\n                        <a href="#">\r\n                            <small data-bind="text: model.text"></small>\r\n                        </a>\r\n                    </span>\r\n                </li>\r\n                <!-- ko if: model.opened -->\r\n                    <li style="position: relative">\r\n                        <!-- ko content: \'submenu\', virtual: true -->\r\n                        <!-- /ko -->\r\n                    </li>\r\n                <!-- /ko -->\r\n            <!-- /ko -->\r\n\r\n            <!-- ko hasNotContent: \'submenu\', virtual: true -->\r\n                <li data-bind="click: click" class="option">\r\n                    <span class="line">\r\n                        <!-- ko if: model.iconFont -->\r\n                            <span data-bind="css: model.iconFont"></span>\r\n                        <!-- /ko -->\r\n                        <a href="#" data-bind="click: click, attr: { href: url }">\r\n                            <small data-bind="text: model.text"></small>\r\n                        </a>\r\n                    </span>\r\n                </li>\r\n            <!-- /ko -->\r\n        </ul>\r\n    </li>\r\n</quark-component>\r\n'}),define("qk-alchemy/components/layout/sidebar/link.component",["knockout","quark","text!./link.component.html","../../../lib/utils","../sidebar.component"],function(n,e,t,i,o){function r(t,a){var s=this;e.parameters({iconFont:n.observable("glyphicon glyphicon-star"),text:n.observable("Menu Option"),pageName:n.observable(),pageParams:n.observable(),opened:n.observable(!1)},t,this),a.init=function(n,e,t){var a=i.findContainer(t,[o.modelType,r]);if(!a)throw new Error("This component must be used inside an al-layout-sidebar or an al-layout-sidebar-link component")},a.arrow=n.pureComputed(function(){return s.opened()?"glyphicon-menu-down":"glyphicon-menu-right"},a),this.toggle=function(){s.opened(!s.opened()),a.click()},a.click=function(){var n=a.url();n&&e.redirect(n)},a.url=n.pureComputed(function(){var n=s.pageName(),t=s.pageParams();return n?"#"+e.routing.hash(n,t):""})}return e.component(r,t)}),define("text!qk-alchemy/components/layout/sidebar/search.component.html",[],function(){return'<quark-component>\r\n    <li>\r\n        <form data-bind="submit: search">\r\n            <div class="input-group">\r\n                <input type="text" class="form-control" data-bind="value: model.value,\r\n                                                                   attr: { placeholder: model.placeholder }">\r\n                <span class="input-group-btn">\r\n                    <button class="btn btn-default searchbutton" type="submit" data-bind="css: btnClass">\r\n                        &nbsp;<span class="glyphicon glyphicon-search"></span>\r\n                    </button>\r\n                </span>\r\n            </div>\r\n        </form>\r\n    </li>\r\n</quark-component>\r\n'}),define("qk-alchemy/components/layout/sidebar/search.component",["knockout","quark","text!./search.component.html","../../../lib/utils","../sidebar.component"],function(n,e,t,i,o){function r(t,r){var a=this;e.parameters({value:n.observable(""),placeholder:n.observable("Search..."),style:n.observable("default"),onSearch:function(n){}},t,this),r.search=function(){e.call(a.onSearch,a.value())},r.init=function(n,e,t){var r=i.findContainer(t,o.modelType);if(!r)throw new Error("This component must be used inside an al-layout-sidebar component")},r.btnClass=n.pureComputed(function(){var n=a.style();switch(n){case"danger":case"warning":case"success":case"primary":return"btn-"+n;default:return"btn-default"}},r)}return e.component(r,t)}),define("text!qk-alchemy/components/layout/sidebar/title.component.html",[],function(){return'<quark-component>\r\n    <li data-bind="onBind: init">\r\n        <h5 class="line text-primary" data-bind="text: model.text"></h5>\r\n    </li>\r\n</quark-component>\r\n'}),define("qk-alchemy/components/layout/sidebar/title.component",["knockout","quark","text!./title.component.html","../../../lib/utils","../sidebar.component"],function(n,e,t,i,o){function r(t,r){e.parameters({iconFont:n.observable("glyphicon glyphicon-star"),text:n.observable("Menu Title")},t,this),r.init=function(n,e,t){var r=i.findContainer(t,o.modelType);if(!r)throw new Error("This component must be used inside an al-sidebar component")}}return e.component(r,t)});