define("text!qk-alchemy/components/layout/sidebar.component.html",[],function(){return'<quark-component>\r\n    <div class="sidebar" data-bind="onBind: init,\r\n                                    css: classes,\r\n                                    style: styles">\r\n        <span data-bind="css: resizerClass">\r\n            <button class="resizer" data-bind="onBind: initResizer,\r\n                              style: resizerStyle">\r\n               <span class="glyphicon glyphicon-option-vertical"></span>\r\n            </button>\r\n        </span>\r\n\r\n        <ul data-bind="style: { marginTop: model.marginTop }">\r\n            <!-- ko content -->\r\n            <!-- /ko -->\r\n        </ul>\r\n    </div>\r\n</quark-component>\r\n'}),define("qk-alchemy/components/layout/sidebar.component",["knockout","quark","text!./sidebar.component.html","../../lib/utils","../layout.component"],function(n,e,t,o,r){function i(t,i,a){function s(n){n?$(k).css("top","50px"):$(k).css("top","0px")}function l(n){n.pageX>g.sidebarSize()-h.resizerWidth()?$(v).show():$(v).hide()}function c(){h.resizing()||$(v).hide()}function u(n){y=n.offsetX,h.resizing(!0),g.sidebarSize(n.pageX+(h.resizerWidth()-y))}function d(n){h.resizing(!1)}function m(n){h.resizing()&&g.sidebarSize(n.pageX+(h.resizerWidth()-y))}var p,b,h=this,f=n.observable();this.resizing=n.observable(!1),e.parameters({resizerWidth:n.observable(10),marginTop:n.observable(0)},t,this);var k,v,y,g={sidebarSize:n.observable(),minSidebarSize:n.observable()},z={resizing:h.resizing.subscribe(function(n){n?($(window).on("mousemove",m),$(window).on("mouseup",d)):($(window).off("mousemove",m),$(window).off("mouseup",d))})};i.init=function(n,i,a){k=n;var u=o.findContainer(a,r.modelType);if(!u)throw new Error("The sidebar component must be used inside an al-layout component");g.sidebarSize=u.sidebarSize,g.minSidebarSize=u.minSidebarSize,p=u.hasNavbar,b=u.hasSidebar,f=u.containerSize,e.inject(t,g),u.hasSidebar(!0),h.sidebarSize=u.sidebarSize,h.minSidebarSize=u.minSidebarSize,z.hasNavbar=p.subscribe(function(n){s(n)}),$(k).on("mousemove",l),$(k).on("mouseleave",c),s(p())},i.initResizer=function(n){v=n,$(v).on("mousedown",u)},this.width=n.pureComputed(function(){return g.sidebarSize()+"px"}),i.styles=n.pureComputed(function(){var n={width:g.sidebarSize()+"px"};return n}),i.classes=n.pureComputed(function(){return"sidebar-col-"+f()}),i.resizerClass=n.pureComputed(function(){return"resizer-"+f()}),i.resizerStyle=n.pureComputed(function(){var n=h.resizerWidth(),e={fontSize:n};return e.left=h.sidebarSize()-n+"px",e}),i.dispose=function(){b(!1),z.resizing.dispose(),z.hasNavbar.dispose(),$(v).off("mousedown",u),$(k).off("mousemove",l),$(k).off("mouseleave",c),$(window).off("mousemove",m),$(window).off("mouseup",d)}}return e.component(i,t)}),define("text!qk-alchemy/components/layout/sidebar/imagebutton.component.html",[],function(){return'<quark-component>\r\n    <li class="text-center imagebutton" data-bind="onBind: init,\r\n                                                   click: click">\r\n        <a data-bind="click: click, attr: { href: url }">\r\n            <!-- ko if: model.icon -->\r\n                <div data-bind="css: model.icon"></div><br />\r\n            <!-- /ko -->\r\n            <small class="sidebar-text" data-bind="text: model.text,\r\n                                                   css: { notext: hideText }">\r\n            </small>\r\n        </a>\r\n    </li>\r\n</quark-component>\r\n'}),define("qk-alchemy/components/layout/sidebar/imagebutton.component",["knockout","quark","text!./imagebutton.component.html","../../../lib/utils","../sidebar.component"],function(n,e,t,o,r){function i(t,i){var a=this;e.parameters({pageName:n.observable(),pageParams:n.observable(),icon:n.observable("glyphicon glyphicon-star"),text:n.observable("Button"),hideTextAt:n.observable(85)},t,this);var s=n.observable();i.init=function(n,e,t){var i=o.findContainer(t,r.modelType);if(!i)throw new Error("This component must be used inside an al-layout-sidebar component");i.sidebarSize&&(s=i.sidebarSize)},i.hideText=n.pureComputed(function(){return s()<a.hideTextAt()}),i.click=function(){var n=i.url();n&&e.redirect(n)},i.url=n.pureComputed(function(){var n=a.pageName(),t=a.pageParams();return n?"#"+e.routing.hash(n,t):""})}return e.component(i,t)}),define("text!qk-alchemy/components/layout/sidebar/link.component.html",[],function(){return'<quark-component>\r\n    <li data-bind="onBind: init">\r\n        <ul>\r\n            <!-- ko hasContent: \'submenu\', virtual: true -->\r\n                <li class="option" style="position: relative" data-bind="click: model.toggle">\r\n                    <small style="position: absolute" class="glyphicon" data-bind="css: arrow">\r\n                    </small>\r\n\r\n                    <span class="line">\r\n                        <!-- ko if: model.iconFont -->\r\n                            <span data-bind="css: model.iconFont"></span>\r\n                        <!-- /ko -->\r\n\r\n                        <a href="#">\r\n                            <small data-bind="text: model.text"></small>\r\n                        </a>\r\n                    </span>\r\n                </li>\r\n                <!-- ko if: model.opened -->\r\n                    <li style="position: relative">\r\n                        <!-- ko content: \'submenu\', virtual: true -->\r\n                        <!-- /ko -->\r\n                    </li>\r\n                <!-- /ko -->\r\n            <!-- /ko -->\r\n\r\n            <!-- ko hasNotContent: \'submenu\', virtual: true -->\r\n                <li data-bind="click: click" class="option">\r\n                    <span class="line">\r\n                        <!-- ko if: model.iconFont -->\r\n                            <span data-bind="css: model.iconFont"></span>\r\n                        <!-- /ko -->\r\n                        <a href="#" data-bind="click: click, attr: { href: url }">\r\n                            <small data-bind="text: model.text"></small>\r\n                        </a>\r\n                    </span>\r\n                </li>\r\n            <!-- /ko -->\r\n        </ul>\r\n    </li>\r\n</quark-component>\r\n'}),define("qk-alchemy/components/layout/sidebar/link.component",["knockout","quark","text!./link.component.html","../../../lib/utils","../sidebar.component"],function(n,e,t,o,r){function i(t,a){var s=this;e.parameters({iconFont:n.observable("glyphicon glyphicon-star"),text:n.observable("Menu Option"),pageName:n.observable(),pageParams:n.observable(),opened:n.observable(!1)},t,this),a.init=function(n,e,t){var a=o.findContainer(t,[r.modelType,i]);if(!a)throw new Error("This component must be used inside an al-layout-sidebar or an al-layout-sidebar-link component")},a.arrow=n.pureComputed(function(){return s.opened()?"glyphicon-menu-down":"glyphicon-menu-right"},a),this.toggle=function(){s.opened(!s.opened()),a.click()},a.click=function(){var n=a.url();n&&e.redirect(n)},a.url=n.pureComputed(function(){var n=s.pageName(),t=s.pageParams();return n?"#"+e.routing.hash(n,t):""})}return e.component(i,t)}),define("text!qk-alchemy/components/layout/sidebar/search.component.html",[],function(){return'<quark-component>\r\n    <li>\r\n        <form data-bind="submit: search">\r\n            <div class="input-group">\r\n                <input type="text" class="form-control" data-bind="value: model.value,\r\n                                                                   attr: { placeholder: model.placeholder }">\r\n                <span class="input-group-btn">\r\n                    <button class="btn btn-default searchbutton" type="submit" data-bind="css: btnClass">\r\n                        &nbsp;<span class="glyphicon glyphicon-search"></span>\r\n                    </button>\r\n                </span>\r\n            </div>\r\n        </form>\r\n    </li>\r\n</quark-component>\r\n'}),define("qk-alchemy/components/layout/sidebar/search.component",["knockout","quark","text!./search.component.html","../../../lib/utils","../sidebar.component"],function(n,e,t,o,r){function i(t,i){var a=this;e.parameters({value:n.observable(""),placeholder:n.observable("Search..."),style:n.observable("default"),onSearch:function(n){}},t,this),i.search=function(){e.call(a.onSearch,a.value())},i.init=function(n,e,t){var i=o.findContainer(t,r.modelType);if(!i)throw new Error("This component must be used inside an al-layout-sidebar component")},i.btnClass=n.pureComputed(function(){var n=a.style();switch(n){case"danger":case"warning":case"success":case"primary":return"btn-"+n;default:return"btn-default"}},i)}return e.component(i,t)}),define("text!qk-alchemy/components/layout/sidebar/title.component.html",[],function(){return'<quark-component>\r\n    <li data-bind="onBind: init">\r\n        <h5 class="line text-primary" data-bind="text: model.text"></h5>\r\n    </li>\r\n</quark-component>\r\n'}),define("qk-alchemy/components/layout/sidebar/title.component",["knockout","quark","text!./title.component.html","../../../lib/utils","../sidebar.component"],function(n,e,t,o,r){function i(t,i){e.parameters({iconFont:n.observable("glyphicon glyphicon-star"),text:n.observable("Menu Title")},t,this),i.init=function(n,e,t){var i=o.findContainer(t,r.modelType);if(!i)throw new Error("This component must be used inside an al-sidebar component")}}return e.component(i,t)});